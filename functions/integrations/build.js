const esbuild = require("esbuild")

esbuild
  .build({
    entryPoints: ["index.ts"],
    bundle: true,
    platform: "node",
    target: "node20",
    outfile: "dist/index.js",
    external: ["@aws-sdk/*"],
    minify: false,
    sourcemap: true,
    format: "cjs",
  })
  .then(() => {
    console.log("✅ Build complete! Check dist/index.js")
  })
  .catch((e) => {
    console.error("❌ Build failed:", e)
    process.exit(1)
  })
