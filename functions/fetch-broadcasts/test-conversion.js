// Test the timezone conversion logic

function convertToUTC(yyyy, mm, dd, hh, min, ss, region) {
  const year = parseInt(yyyy)
  const month = parseInt(mm)
  const day = parseInt(dd)
  const hour = parseInt(hh)
  const minute = parseInt(min)
  const second = parseInt(ss)

  // Fixed timezone offsets in minutes (broadcast systems use standard time year-round)
  let offsetMinutes
  switch (region.toUpperCase()) {
    case "SYD":
    case "MEL":
    case "BNE":
      offsetMinutes = 10 * 60 // AEST (UTC+10)
      break
    case "ADL":
    case "ADE":
      offsetMinutes = 9 * 60 + 30 // ACST (UTC+9:30)
      break
    case "PER":
      offsetMinutes = 8 * 60 // AWST (UTC+8)
      break
    default:
      offsetMinutes = 10 * 60 // Default to AEST
  }

  // Create date treating input values as UTC, then subtract offset to get actual UTC
  const utcBase = Date.UTC(year, month - 1, day, hour, minute, second)
  const utcTimestamp = utcBase - offsetMinutes * 60 * 1000

  return new Date(utcTimestamp).toISOString()
}

// Test cases from the BRI-NINE log file
console.log("Brisbane (BNE/BRI) - UTC+10:")
console.log("Input:    2026-01-04 00:00:59 (Brisbane local time)")
console.log(
  "Output:  ",
  convertToUTC("2026", "01", "04", "00", "00", "59", "BNE")
)
console.log("Expected: 2026-01-03T14:00:59.000Z")
console.log()

console.log("Input:    2026-01-04 00:02:14 (Brisbane local time)")
console.log(
  "Output:  ",
  convertToUTC("2026", "01", "04", "00", "02", "14", "BNE")
)
console.log("Expected: 2026-01-03T14:02:14.000Z")
