const fs = require("fs")
const path = require("path")
const dirs = fs.readdirSync(__dirname)
const _ = require("underscore")
const env_files = _(dirs).filter(v => {
  return v.match(/^\.env*/) !== null
})
let envs = []
let additional = []
for (let v of env_files) {
  let file_names = v.split(".")
  file_names.shift()
  const vars = fs.readFileSync(`${__dirname}/${v}`, "utf8").split("\n")
  let prefix = ""
  if (file_names[1] != undefined) {
    additional.push(file_names[1].toLowerCase())
    prefix = `__${file_names[1].toUpperCase()}__`
  } else {
    additional.push("alishackers")
  }
  for (let v2 of vars) {
    envs.push(`${prefix}${v2}`)
  }
}
let env_obj = require("dotenv").parse(envs.join("\n"))
for (let k in env_obj) {
  process.env[k] = env_obj[k]
}
process.env.__MULTI_ENV__ = additional.join(",")
