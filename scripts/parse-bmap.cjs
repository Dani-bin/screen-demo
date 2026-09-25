const fs = require("fs")
const s = fs.readFileSync("node_modules/bmap-draw/dist/bmap-draw.min.js", "utf8")
const start = s.indexOf("getNorthEast")
console.log(s.slice(start - 200, start + 2800))
