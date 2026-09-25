const fs = require("fs")
const s = fs.readFileSync("node_modules/bmap-draw/dist/bmap-draw.min.js", "utf8")
const idx = s.indexOf("ni=function")
console.log(s.slice(idx + 2000, idx + 4500))
