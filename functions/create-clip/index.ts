import { PrismaClient } from "@prisma/client"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { exec } from "child_process"
import { promisify } from "util"
import fs from "fs/promises"
import path from "path"
import os from "os"

const execAsync = promisify(exec)
const prisma = new PrismaClient()

// Initialize S3 client outside handler for connection reuse
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "ap-southeast-2",
})

interface LambdaEvent {
  programSlug: string
  channel: string
  region: string
  date: string // YYYY-MM-DD
  time: string // HH:MM:SS
  secondsBefore: number
  secondsAfter: number
  assetId: string
}

export const handler = async (event: LambdaEvent) => {
  try {
    const {
      programSlug,
      channel,
      region,
      date,
      time,
      secondsBefore,
      secondsAfter,
      assetId,
    } = event

    // Validate required fields
    if (
      !programSlug ||
      !channel ||
      !region ||
      !date ||
      !time ||
      secondsBefore === undefined ||
      secondsAfter === undefined ||
      !assetId
    ) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields" }),
      }
    }

    // Combine date and time
    const fullDateTime = `${date}T${time}`
    const centerTime = new Date(fullDateTime)
    const startTime = new Date(centerTime.getTime() - secondsBefore * 1000)
    const endTime = new Date(centerTime.getTime() + secondsAfter * 1000)

    // Convert to Unix timestamps for stream URL (add 15 second offset)
    const centerTimestamp = Math.floor(centerTime.getTime() / 1000) + 15
    const startTimestamp = centerTimestamp - secondsBefore
    const endTimestamp = centerTimestamp + secondsAfter

    // Find the program
    const program = await prisma.program.findUnique({
      where: { slug: programSlug },
    })

    if (!program) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Program not found" }),
      }
    }

    // Find the day for this date
    const [year, month, dayNum] = date.split("-").map(Number)
    const dayDate = new Date(Date.UTC(year, month - 1, dayNum, 0, 0, 0, 0))

    const day = await prisma.day.findFirst({
      where: {
        programId: program.id,
        date: dayDate,
      },
    })

    if (!day) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: "No day found for this date. Please create the day first.",
        }),
      }
    }

    // Find or create broadcast for this time window
    let broadcast = await prisma.broadcast.findFirst({
      where: {
        dayId: day.id,
        channel: channel,
        region: region,
        startTime: {
          lte: startTime,
        },
        endTime: {
          gte: endTime,
        },
      },
    })

    if (!broadcast) {
      // Create a new broadcast
      broadcast = await prisma.broadcast.create({
        data: {
          name: `${channel} ${region} - ${centerTime.toLocaleTimeString("en-AU", { hour12: false })}`,
          startTime: startTime,
          endTime: endTime,
          channel: channel,
          region: region,
          dayId: day.id,
        },
      })
    }

    // Construct stream URL
    const regionCode = region.toLowerCase()
    const channelCode = channel === "CH9" ? "ch9" : channel.toLowerCase()
    const streamUrl = `https://prod-simulcast-${regionCode}-${channelCode}.livestream-cdn.9vms.com.au/u/prod/simulcast/${regionCode}/${channelCode}/hls/r1/index.m3u8?start=${startTimestamp}&end=${endTimestamp}&aws.manifestfilter=audio_codec:AACL;video_height:720-720;video_framerate:25-25`

    // Create temporary directory for download
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clip-"))
    const tempFilePath = path.join(tempDir, "clip.mp4")

    try {
      // Download stream using ffmpeg with precise duration
      const duration = secondsBefore + secondsAfter
      const ffmpegCommand = `ffmpeg -i "${streamUrl}" -t ${duration} -c:v libx264 -preset fast -c:a aac -y "${tempFilePath}"`

      console.log(`Downloading clip: ${ffmpegCommand}`)
      await execAsync(ffmpegCommand, { timeout: 300000 }) // 5 minute timeout

      // Read the file
      const fileBuffer = await fs.readFile(tempFilePath)

      // Generate S3 key
      const timestamp = centerTime.toISOString().replace(/[:.]/g, "-")
      const s3Key = `videos/${timestamp}.mp4`

      // Upload to S3
      const uploadParams = {
        Bucket: process.env.S3_BUCKET!,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: "video/mp4",
      }

      console.log(`Uploading to S3: ${s3Key}`)
      await s3Client.send(new PutObjectCommand(uploadParams))

      // Create detection
      const detection = await prisma.detection.create({
        data: {
          video: s3Key,
          startTime: startTime,
          endTime: endTime,
          broadcastId: broadcast.id,
          assetId: assetId,
          isBillboard: false,
          falsePositive: false,
        },
      })

      // Cleanup temp files
      await fs.unlink(tempFilePath)
      await fs.rmdir(tempDir)

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          detection,
          broadcast,
          day,
        }),
      }
    } catch (error) {
      // Cleanup on error
      try {
        await fs.unlink(tempFilePath).catch(() => {})
        await fs.rmdir(tempDir).catch(() => {})
      } catch {}
      throw error
    }
  } catch (error) {
    console.error("Error creating clip:", error)
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to create clip",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
    }
  } finally {
    await prisma.$disconnect()
  }
}
