import { PrismaClient, Channel, Region, BroadcastStatus } from "@prisma/client"
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3"
import { S3Event } from "aws-lambda"
import { Readable } from "stream"
import { parseLogs } from "./logParser"

// Initialize Prisma client
const prisma = new PrismaClient()

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "ap-southeast-2",
})

// Helper function to get a file from S3
async function getS3File(bucket: string, key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  })

  const response = await s3Client.send(command)
  const stream = response.Body as Readable

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on("data", (chunk) => chunks.push(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
  })
}

// Map log file channel names to database enum
function mapChannel(logChannel: string): Channel | null {
  const channelMap: Record<string, Channel> = {
    NINE: Channel.CH9,
    GO: Channel.GO,
    GEM: Channel.GEM,
  }
  return channelMap[logChannel.toUpperCase()] || null
}

// Map log file region names to database enum
function mapRegion(logRegion: string): Region | null {
  const regionMap: Record<string, Region> = {
    SYD: Region.SYD,
    MEL: Region.MEL,
    BRI: Region.BNE,
    BNE: Region.BNE,
    PER: Region.PER,
    ADL: Region.ADL,
    ADE: Region.ADL, // Adelaide files use ADE prefix
  }
  return regionMap[logRegion.toUpperCase()] || null
}

// Parse filename to extract metadata: YYYYMMDD_REGION-CHANNEL.LOG
function parseLogFileName(
  fileName: string
): { date: Date; region: Region; channel: Channel } | null {
  const match = fileName.match(/(\d{8})_(\w+)-(\w+)\.LOG/i)
  if (!match) return null

  const [, dateStr, regionStr, channelStr] = match

  // Map region and channel
  const region = mapRegion(regionStr)
  const channel = mapChannel(channelStr)

  // Return null if region or channel is not supported
  if (!region || !channel) {
    console.log(
      `⚠️  Unsupported region (${regionStr}) or channel (${channelStr}) - skipping file`
    )
    return null
  }

  const year = parseInt(dateStr.substring(0, 4))
  const month = parseInt(dateStr.substring(4, 6)) - 1
  const day = parseInt(dateStr.substring(6, 8))

  return {
    date: new Date(year, month, day),
    region,
    channel,
  }
}

export const handler = async (event: S3Event) => {
  console.log("📥 Received S3 event:", JSON.stringify(event, null, 2))

  try {
    // Fetch all programs from database
    const programs = await prisma.program.findMany({
      select: {
        id: true,
        name: true,
        keyword: true,
        year: true,
      },
    })

    console.log(`📚 Found ${programs.length} programs in database`)

    const results = []

    // Process each S3 record
    for (const record of event.Records) {
      const bucket = record.s3.bucket.name
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "))

      console.log(`\n📄 Processing file: ${key}`)

      // Parse filename to get metadata
      const fileMetadata = parseLogFileName(key.split("/").pop() || "")
      if (!fileMetadata) {
        console.warn(`⚠️  Could not parse filename: ${key}`)
        continue
      }

      const { date, region, channel } = fileMetadata
      console.log(
        `📅 Date: ${date.toISOString()}, Region: ${region}, Channel: ${channel}`
      )

      // Get log file from S3
      const logFileContent = await getS3File(bucket, key)

      // Parse the log file
      const parsedLogs = parseLogs(logFileContent, region)
      console.log(
        `✅ Parsed ${parsedLogs.programs.length} program entries from log`
      )

      // Track days that need log file entries (only for matched programs)
      const daysNeedingLogFiles = new Set<string>()

      // Match programs with database entries using keywords
      for (const program of programs) {
        // Find all log entries matching this program's keyword
        const matchingEntries = parsedLogs.programs.filter((logEntry) =>
          logEntry.databaseTitle
            .toUpperCase()
            .includes(program.keyword.toUpperCase())
        )

        if (matchingEntries.length === 0) {
          console.log(
            `  ⏭️  No matches for program: ${program.name} (keyword: ${program.keyword})`
          )
          continue
        }

        console.log(
          `  🎯 Found ${matchingEntries.length} log entries for: ${program.name}`
        )

        // Group consecutive program segments together
        // A segment ends when there's a significant time gap (30+ minutes) between matching entries
        const broadcastSegments: Array<{
          startEntry: (typeof matchingEntries)[0]
          endEntry: (typeof matchingEntries)[0]
        }> = []

        const MAX_GAP_MINUTES = 30 // Allow 30-minute gaps for ad breaks

        let currentSegmentStart = 0
        for (let i = 0; i < matchingEntries.length; i++) {
          const currentEntry = matchingEntries[i]
          const nextEntry = matchingEntries[i + 1]

          // Check if this is the last entry or if there's a significant gap to the next entry
          if (!nextEntry) {
            // Last entry - close the current segment
            broadcastSegments.push({
              startEntry: matchingEntries[currentSegmentStart],
              endEntry: currentEntry,
            })
          } else {
            // Check time gap between current and next entry
            const currentTime = currentEntry.dateTime
              ? new Date(currentEntry.dateTime)
              : null
            const nextTime = nextEntry.dateTime
              ? new Date(nextEntry.dateTime)
              : null

            if (currentTime && nextTime) {
              const gapMinutes =
                (nextTime.getTime() - currentTime.getTime()) / (1000 * 60)

              if (gapMinutes > MAX_GAP_MINUTES) {
                // Significant gap - close current segment and start new one
                broadcastSegments.push({
                  startEntry: matchingEntries[currentSegmentStart],
                  endEntry: currentEntry,
                })
                currentSegmentStart = i + 1
              }
            }
          }
        }

        console.log(
          `  📺 Identified ${broadcastSegments.length} broadcast segment(s)`
        )

        // Find or create Day (do this once per matched program, not per segment)
        const dayName = `${program.name} - ${date.toLocaleDateString("en-AU", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}`

        let day = await prisma.day.findFirst({
          where: {
            programId: program.id,
            date: date,
          },
        })

        if (!day) {
          console.log(`  ➕ Creating new day: ${dayName}`)
          day = await prisma.day.create({
            data: {
              name: dayName,
              date: date,
              programId: program.id,
            },
          })
        } else {
          console.log(`  ✓  Day already exists: ${dayName}`)
        }

        // Track this day for log file creation (happens for matched programs regardless of broadcast creation)
        daysNeedingLogFiles.add(day.id)

        // Process each broadcast segment
        for (const segment of broadcastSegments) {
          const { startEntry, endEntry } = segment

          if (!startEntry.time || !startEntry.dateTime) {
            console.warn(`  ⚠️  Skipping segment without valid start time`)
            continue
          }

          // Parse and validate start time
          const startTime = new Date(startEntry.dateTime)
          if (isNaN(startTime.getTime())) {
            console.warn(
              `  ⚠️  Skipping segment with invalid start date: ${startEntry.dateTime}`
            )
            continue
          }

          // Find end time: next DIFFERENT program after the last entry in this segment
          let endTime: Date
          const nextDifferentProgram = parsedLogs.programs.find(
            (e) =>
              e.lineNumber > endEntry.lineNumber &&
              !e.databaseTitle
                .toUpperCase()
                .includes(program.keyword.toUpperCase()) &&
              e.dateTime
          )

          if (nextDifferentProgram && nextDifferentProgram.dateTime) {
            endTime = new Date(nextDifferentProgram.dateTime)
            // Validate end time
            if (isNaN(endTime.getTime())) {
              endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000)
            }
          } else {
            // Default to 2 hours if no next program found
            endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000)
          }

          // Check if an overlapping broadcast already exists for this day/channel/region
          const overlappingBroadcast = await prisma.broadcast.findFirst({
            where: {
              dayId: day.id,
              channel: channel,
              region: region,
              OR: [
                // New broadcast starts during existing broadcast
                {
                  AND: [
                    { startTime: { lte: startTime } },
                    { endTime: { gt: startTime } },
                  ],
                },
                // New broadcast ends during existing broadcast
                {
                  AND: [
                    { startTime: { lt: endTime } },
                    { endTime: { gte: endTime } },
                  ],
                },
                // New broadcast completely contains existing broadcast
                {
                  AND: [
                    { startTime: { gte: startTime } },
                    { endTime: { lte: endTime } },
                  ],
                },
              ],
            },
          })

          if (overlappingBroadcast) {
            console.log(
              `  ⏭️  Overlapping broadcast already exists: ${
                overlappingBroadcast.name
              } (${overlappingBroadcast.startTime.toISOString()} - ${overlappingBroadcast.endTime.toISOString()})`
            )
            continue
          }

          // Create broadcast
          const broadcast = await prisma.broadcast.create({
            data: {
              name: `${startEntry.databaseTitle} (${region})`,
              startTime: startTime,
              endTime: endTime,
              status: BroadcastStatus.PENDING,
              channel: channel,
              region: region,
              dayId: day.id,
            },
          })

          console.log(
            `  ✅ Created broadcast: ${
              broadcast.name
            } (${startTime.toLocaleTimeString()} - ${endTime.toLocaleTimeString()})`
          )

          results.push({
            program: program.name,
            broadcast: broadcast.id,
            startTime,
            endTime,
          })
        }
      }

      // Create LogFile entries for matched programs (only for 5 main regions)
      const mainRegions = [
        Region.SYD,
        Region.MEL,
        Region.BNE,
        Region.PER,
        Region.ADL,
      ]

      console.log(
        `\n📋 LogFile check: Region=${region}, MainRegion=${mainRegions.includes(
          region
        )}, DaysTracked=${daysNeedingLogFiles.size}`
      )

      if (mainRegions.includes(region) && daysNeedingLogFiles.size > 0) {
        for (const dayId of daysNeedingLogFiles) {
          const existingLogFile = await prisma.logFile.findUnique({
            where: { s3_key: key },
          })

          if (!existingLogFile) {
            console.log(
              `  📄 Adding log file reference: ${key} -> dayId: ${dayId}, region: ${region}, channel: ${channel}`
            )
            await prisma.logFile.create({
              data: {
                s3_key: key,
                dayId: dayId,
                region: region,
                channel: channel,
              },
            })
            break // Only create once per file
          } else {
            console.log(`  ✓  Log file reference already exists: ${key}`)
            break
          }
        }
      } else {
        console.log(
          `  ⏭️  Skipping LogFile creation (region not in main list or no programs matched)`
        )
      }
    }

    console.log(
      `\n🎉 Processing complete. Created ${results.length} broadcasts`
    )

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: `Processed ${event.Records.length} file(s)`,
        broadcastsCreated: results.length,
        results,
      }),
    }
  } catch (error) {
    console.error("❌ Error processing log files:", error)
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    }
  } finally {
    await prisma.$disconnect()
  }
}
