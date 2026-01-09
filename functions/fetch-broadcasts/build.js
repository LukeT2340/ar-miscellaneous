const esbuild = require("esbuild")
const fs = require("fs")
const path = require("path")

async function build() {
  // Build with esbuild
  await esbuild.build({
    entryPoints: ["index.ts"],
    bundle: true,
    platform: "node",
    target: "node20",
    outfile: "dist/index.js",
    external: ["@aws-sdk/*", "@prisma/client", ".prisma/client"],
    minify: false,
    sourcemap: true,
    format: "cjs",
  })

  console.log("✅ Build complete!")

  // Copy Prisma files
  const prismaClientPath = path.join(
    __dirname,
    "node_modules",
    ".prisma",
    "client"
  )
  const distPrismaPath = path.join(
    __dirname,
    "dist",
    "node_modules",
    ".prisma",
    "client"
  )

  if (fs.existsSync(prismaClientPath)) {
    console.log("📦 Copying Prisma Client files...")
    fs.mkdirSync(path.dirname(distPrismaPath), { recursive: true })
    fs.cpSync(prismaClientPath, distPrismaPath, { recursive: true })
    console.log("✅ Prisma Client files copied!")
  } else {
    console.warn(
      "⚠️  Prisma Client not found. Run 'npx prisma generate' first."
    )
  }

  // Copy @prisma/client package
  const prismaPackagePath = path.join(
    __dirname,
    "node_modules",
    "@prisma",
    "client"
  )
  const distPrismaPackagePath = path.join(
    __dirname,
    "dist",
    "node_modules",
    "@prisma",
    "client"
  )

  if (fs.existsSync(prismaPackagePath)) {
    console.log("📦 Copying @prisma/client package...")
    fs.mkdirSync(path.dirname(distPrismaPackagePath), { recursive: true })
    fs.cpSync(prismaPackagePath, distPrismaPackagePath, { recursive: true })
    console.log("✅ @prisma/client package copied!")
  }

  console.log("\n🎉 Lambda package ready in dist/")
}

build().catch((e) => {
  console.error("❌ Build failed:", e)
  process.exit(1)
})
