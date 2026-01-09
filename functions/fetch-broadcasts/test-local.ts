import { handler } from "./index"
import * as fs from "fs"

// Set environment variables for testing
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://user:password@localhost:5432/broadcasts"
process.env.DATABASE_SSL = "false"
process.env.S3_BUCKET = process.env.S3_BUCKET || "your-s3-bucket-name"
process.env.AWS_REGION = "ap-southeast-2"

// Mock the getS3File function for local testing
// This allows you to test with a local file instead of fetching from S3
async function testLocalFile() {
  console.log("🧪 Testing Lambda function locally...\n")

  // Create a test event
  const testEvent = {
    channel: "NINE",
    region: "BRI",
    date: "20260104",
  }

  console.log("📥 Test Event:", testEvent)
  console.log("─".repeat(60))

  try {
    // Call the handler
    const result = await handler(testEvent)

    console.log("\n✅ Lambda Response:")
    console.log("Status Code:", result.statusCode)
    console.log("\n📊 Response Body:")

    const body = JSON.parse(result.body)
    console.log(JSON.stringify(body, null, 2))

    // Additional details
    if (body.success) {
      console.log("\n📈 Summary:")
      console.log(`  - Total Entries: ${body.data.totalEntries}`)
      console.log(`  - Billboards: ${body.data.billboards?.length || 0}`)
      console.log(`  - Programs: ${body.data.programs?.length || 0}`)

      if (body.data.billboards?.length > 0) {
        console.log("\n🎯 Sample Billboard:")
        console.log(JSON.stringify(body.data.billboards[0], null, 2))
      }
    }
  } catch (error) {
    console.error("❌ Error:", error)
    process.exit(1)
  }
}

// Alternative: Test with a local LOG file
async function testWithLocalLogFile(filePath: string) {
  console.log("🧪 Testing with local LOG file...\n")
  console.log("📁 File:", filePath)

  try {
    // Read local file
    const fileContent = fs.readFileSync(filePath, "utf-8")

    // Import the parsing function directly
    const { parseLogs, getBillboardsForProgram } = require("./logParser")

    // Parse the logs
    const parsedLogs = parseLogs(fileContent)

    console.log("\n📊 Parsing Results:")
    console.log(`  - Total Entries: ${parsedLogs.allEntries.length}`)
    console.log(`  - Billboards: ${parsedLogs.billboards.length}`)
    console.log(`  - Programs: ${parsedLogs.programs.length}`)

    // Example: Find billboards for a specific program
    const programKeyword = "UNITED CUP"
    const programBillboards = getBillboardsForProgram(
      parsedLogs,
      programKeyword
    )

    console.log(
      `\n🎯 Billboards for "${programKeyword}": ${programBillboards.length}`
    )

    if (programBillboards.length > 0) {
      console.log("\n📺 Sample Program Billboard:")
      console.log(JSON.stringify(programBillboards[0], null, 2))
    }
  } catch (error) {
    console.error("❌ Error:", error)
    process.exit(1)
  }
}

// Main execution
const args = process.argv.slice(2)

if (args[0] === "--file" && args[1]) {
  // Test with local file: npm run test -- --file path/to/file.LOG
  testWithLocalLogFile(args[1])
} else {
  // Test with full Lambda handler (requires S3/DB setup)
  testLocalFile()
}
