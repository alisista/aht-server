require("./env")

const PORT = process.env.PORT || 5000
const express = require("express")
const bodyParser = require("body-parser")
const Routes = require("./routes")

let app = express()
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

for (let v of ["get", "post"]) {
  app[v]("/*", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Headers", "X-Requested-With")
    next()
  })
}
let routes = new Routes()
let namespace = routes.namespace
for (let v of routes.routes) {
  let method = v.method || "get"
  app[method](`/${namespace}${v.route}`, async (req, res, next) => {
    req.PREFIX = namespace
    console.log(`[${method.toUpperCase()}]\t${v.route}`)
    await v.func(req, res)
  })
}

app.listen(PORT, () => console.log(`Listening on ${PORT}`))
