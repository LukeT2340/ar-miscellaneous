import { DateTime } from "luxon"

export interface LogEntry {
  lineNumber: number
  marketChannel: string
  dateTime: string | null
  localDateTime: string | null // Local time before UTC conversion
  time: string | null
  materialKey: string
  materialType: string
  databaseTitle: string
  isBillboard: string | boolean
  billboardType:
    | "Open Billboard"
    | "Middle Billboard"
    | "Close Billboard"
    | null
  rawLine: string
}

export interface ParsedLogData {
  billboards: LogEntry[]
  programs: LogEntry[]
  allEntries: LogEntry[]
}

/**
 * Map region code to IANA timezone identifier
 */
function getTimezoneForRegion(region: string): string {
  const timezoneMap: Record<string, string> = {
    SYD: "Australia/Sydney", // AEDT/AEST (UTC+11/+10, has DST)
    MEL: "Australia/Melbourne", // AEDT/AEST (UTC+11/+10, has DST)
    BNE: "Australia/Brisbane", // AEST (UTC+10, no DST)
    PER: "Australia/Perth", // AWST (UTC+8, no DST)
    ADL: "Australia/Adelaide", // ACDT/ACST (UTC+10.5/+9.5, has DST)
  }
  return timezoneMap[region] || "Australia/Sydney"
}

/**
 * Convert log time from local timezone to UTC ISO string
 * LOG files contain local timestamps for each region, we convert to UTC for database storage
 */
function convertToUTC(
  yyyy: string,
  mm: string,
  dd: string,
  hh: string,
  min: string,
  ss: string,
  region: string
): string {
  const year = parseInt(yyyy)
  const month = parseInt(mm)
  const day = parseInt(dd)
  const hour = parseInt(hh)
  const minute = parseInt(min)
  const second = parseInt(ss)

  const timezone = getTimezoneForRegion(region)

  // Create DateTime in the region's local timezone
  const localTime = DateTime.fromObject(
    { year, month, day, hour, minute, second },
    { zone: timezone }
  )

  // Convert to UTC and return ISO string
  return localTime.toUTC().toISO()!
}

/**
 * Parse AS RUN billboard log files (fixed-width column format).
 *
 * @param logFileContent - Content of the .LOG file as a string
 * @param region - Region code (SYD, MEL, BNE, PER, ADL) for timezone conversion
 *
 * @returns Object containing parsed entries:
 * {
 *   billboards: [],  // Type I entries with OB/MB/CB prefix
 *   programs: [],    // Type M/S entries (program segments)
 *   allEntries: []   // All parsed entries
 * }
 *
 * Column specifications:
 * - Column 1 (6 chars): market-channel combination
 * - Column 56 (20 chars): Date/Time - YYYYMMDD HH:mm:ss:ff
 * - Column 120 (32 chars): Material Key (unique identifier)
 * - Column 189 (1 char): Material Type (I=billboard, M/S=program)
 * - Column 296 (64 chars): Database Title
 */
export function parseLogs(
  logFileContent: string,
  region: string
): ParsedLogData {
  const result: ParsedLogData = {
    billboards: [],
    programs: [],
    allEntries: [],
  }

  const lines = logFileContent.split("\n")

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum]

    // Skip empty lines
    if (!line.trim()) {
      continue
    }

    // Ensure line is long enough to contain all columns we need
    if (line.length < 360) {
      // 296 + 64 = 360 minimum
      continue
    }

    try {
      // Extract fixed-width columns (0-indexed, so subtract 1 from column numbers)

      // Column 1 (0-5): market-channel
      const marketChannel = line.substring(0, 6).trim()

      // Column 56 (55-74): Date/Time - yyMMdd HH:mm:ss:ff
      const dateTimeRaw = line.substring(55, 75).trim()

      // Column 120 (119-150): Material Key
      const materialKey = line.substring(119, 151).trim()

      // Column 189 (188): Material Type
      const materialType = line.length > 188 ? line[188] : ""

      // Column 296 (295-358): Database Title
      const databaseTitle =
        line.length > 295 ? line.substring(295, 359).trim() : ""

      // Parse date/time: YYYYMMDD HH:mm:ss:ff format (e.g., "20260104 06:00:00:02")
      let dateTime: string | null = null
      let localDateTime: string | null = null
      let timeStr: string | null = null

      if (dateTimeRaw && dateTimeRaw.length >= 17) {
        try {
          // Split by space to get date and time parts
          const parts = dateTimeRaw.split(" ")
          if (parts.length >= 2) {
            const datePart = parts[0] // YYYYMMDD
            const timePart = parts[1] // HH:mm:ss:ff

            // Extract date components (YYYYMMDD format)
            if (datePart.length >= 8) {
              const yyyy = datePart.substring(0, 4)
              const mm = datePart.substring(4, 6)
              const dd = datePart.substring(6, 8)

              // Extract time components (remove frames)
              const timeComponents = timePart.split(":")
              if (timeComponents.length >= 3) {
                const hh = timeComponents[0]
                const min = timeComponents[1]
                const ss = timeComponents[2]

                // Store local time
                localDateTime = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`
                timeStr = `${hh}:${min}:${ss}`

                // Convert to UTC based on region
                const utcDateTime = convertToUTC(
                  yyyy,
                  mm,
                  dd,
                  hh,
                  min,
                  ss,
                  region
                )
                dateTime = utcDateTime
              }
            }
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }

      // Determine if this is a billboard (Type I with OB/MB/CB prefix)
      const isBillboard =
        materialType === "I" &&
        databaseTitle &&
        (databaseTitle.startsWith("OB") ||
          databaseTitle.startsWith("MB") ||
          databaseTitle.startsWith("CB"))

      // Determine billboard type
      let billboardType:
        | "Open Billboard"
        | "Middle Billboard"
        | "Close Billboard"
        | null = null
      if (isBillboard) {
        if (databaseTitle.startsWith("OB")) {
          billboardType = "Open Billboard"
        } else if (databaseTitle.startsWith("MB")) {
          billboardType = "Middle Billboard"
        } else if (databaseTitle.startsWith("CB")) {
          billboardType = "Close Billboard"
        }
      }

      // Create entry
      const entry: LogEntry = {
        lineNumber: lineNum + 1,
        marketChannel,
        dateTime,
        localDateTime,
        time: timeStr,
        materialKey,
        materialType,
        databaseTitle,
        isBillboard,
        billboardType,
        rawLine: line.trim(),
      }

      // Add to appropriate lists
      result.allEntries.push(entry)

      if (isBillboard) {
        result.billboards.push(entry)
      } else if (materialType === "M" || materialType === "S") {
        result.programs.push(entry)
      }
    } catch (error) {
      console.warn(`Warning: Error parsing line ${lineNum + 1}:`, error)
      continue
    }
  }

  console.log("✅ Parsed log file:")
  console.log(`   Total entries: ${result.allEntries.length}`)
  console.log(`   Billboards: ${result.billboards.length}`)
  console.log(`   Programs: ${result.programs.length}`)

  return result
}

/**
 * Get all billboards associated with a specific program by finding billboards
 * that aired during the program's broadcast time.
 *
 * @param logData - Parsed log data from parseLogs()
 * @param programKeyword - Keyword to search for in program titles (e.g., "UNITED CUP")
 *
 * @returns List of billboard entries that aired during the program
 */
export function getBillboardsForProgram(
  logData: ParsedLogData,
  programKeyword: string
): LogEntry[] {
  const matchingBillboards: LogEntry[] = []

  // First, find all program instances matching the keyword
  const programInstances = logData.programs.filter((program) =>
    program.databaseTitle.toUpperCase().includes(programKeyword.toUpperCase())
  )

  if (programInstances.length === 0) {
    return matchingBillboards
  }

  // For each program instance, find billboards that aired during it
  for (const program of programInstances) {
    if (!program.time) {
      continue
    }

    // Convert program start time to seconds
    const progParts = program.time.split(":")
    const progSeconds =
      parseInt(progParts[0]) * 3600 +
      parseInt(progParts[1]) * 60 +
      parseInt(progParts[2])

    // Find the next program entry in all_entries to determine end time
    const programLine = program.lineNumber
    let nextProgSeconds: number | null = null

    for (const entry of logData.allEntries) {
      if (
        entry.lineNumber > programLine &&
        (entry.materialType === "M" || entry.materialType === "S")
      ) {
        if (entry.time) {
          const nextParts = entry.time.split(":")
          nextProgSeconds =
            parseInt(nextParts[0]) * 3600 +
            parseInt(nextParts[1]) * 60 +
            parseInt(nextParts[2])
          break
        }
      }
    }

    // Find billboards in this time window
    for (const billboard of logData.billboards) {
      if (!billboard.time) {
        continue
      }

      const bbParts = billboard.time.split(":")
      const bbSeconds =
        parseInt(bbParts[0]) * 3600 +
        parseInt(bbParts[1]) * 60 +
        parseInt(bbParts[2])

      // Check if billboard is between program start and next program
      if (nextProgSeconds !== null) {
        if (progSeconds <= bbSeconds && bbSeconds < nextProgSeconds) {
          if (!matchingBillboards.includes(billboard)) {
            matchingBillboards.push(billboard)
          }
        }
      } else {
        // No next program found, include all billboards after this program
        if (bbSeconds >= progSeconds) {
          if (!matchingBillboards.includes(billboard)) {
            matchingBillboards.push(billboard)
          }
        }
      }
    }
  }

  return matchingBillboards
}
