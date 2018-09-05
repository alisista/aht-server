require("dotenv").config()
const PORT = process.env.PORT || 5000
const rp = require("request-promise")
const simple_oauth2 = require("simple-oauth2")
const express = require("express")
const path = require("path")
const _ = require("underscore")
const async = require("async")
const admin = require("firebase-admin")
const Twit = require("twit")

const credentials_discord = {
  client: {
    id: process.env.DISCORD_CLIENT_ID,
    secret: process.env.DISCORD_CLIENT_SECRET
  },
  auth: {
    tokenHost: "https://discordapp.com",
    tokenPath: "/api/oauth2/token",
    authorizePath: "/api/oauth2/authorize"
  }
}

const oauth2_discord = simple_oauth2.create(credentials_discord)

const serviceAccount = require("./.service-account.json")
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIRESTORE_DATABASE_URL
})

let firestore = admin.firestore()
firestore.settings({ timestampsInSnapshots: true })

let T = new Twit({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token: process.env.TWITTER_ACCESS_TOKEN,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
  timeout_ms: 60 * 1000
})

let app = express()

let access = { following: {}, discord: {} }

class util {
  static async existsDiscordUser(user) {
    let ss = await firestore
      .collection("discord_pool")
      .doc(user.id)
      .get()
    return ss.exists
  }
  static async getDiscordUserFromPool(userid) {
    let ss = await firestore
      .collection("discord_pool")
      .doc(userid)
      .get()
    return ss.data()
  }
  static async addDiscordUserToPool(user) {
    return await firestore
      .collection("discord_pool")
      .doc(user.id)
      .set(user)
      .catch(e => {
        console.log(e)
      })
  }
  static async removeDiscordUserFromPool(user) {
    return await firestore
      .collection("discord_pool")
      .doc(user.id)
      .delete()
      .catch(e => {
        console.log(e)
      })
  }

  static async getUserGuilds(access_token) {
    let body = await rp({
      url: "https://discordapp.com/api/users/@me/guilds",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/x-www-form-urlencoded"
      }
    })
    return JSON.parse(body) || []
  }
  static async getCredentials(userid) {
    let ss = await firestore
      .collection("users_server")
      .doc(userid)
      .get()
    return ss.data()
  }
  static async getFriendship(target) {
    return new Promise((ret, rej) => {
      T.get(
        "friendships/show",
        {
          source_screen_name: process.env.TWITTER_SCREEN_NAME,
          target_id: target
        },
        (e, d) => {
          if (e != null) {
            rej(e)
          } else {
            ret(d)
          }
        }
      )
    })
  }
  static async removeDiscordUser(uid) {
    return await firestore
      .collection("users_server")
      .doc(uid)
      .update({ discord: admin.firestore.FieldValue.delete() })
  }
  static async setDiscordUser(uid, user) {
    try {
      await firestore
        .collection("users_server")
        .doc(uid)
        .update({ discord: user })
    } catch (e) {
      await firestore
        .collection("users_server")
        .doc(uid)
        .set({ discord: user })
    }
    return
  }
  static async getDiscordTokens(code) {
    return await oauth2_discord.authorizationCode.getToken({
      code: code,
      redirect_uri: `${process.env.BACKEND_SERVER_ORIGIN}/oauth/discord`
    })
  }
  static async getDiscordUser(access_token) {
    return JSON.parse(
      await rp({
        url: "https://discordapp.com/api/users/@me",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      })
    )
  }
  static isTooShort(type, uid, res) {
    if (
      access[type][uid] != undefined &&
      Date.now() - access[type][uid] < 1000 * 60 * 60
    ) {
      res.send({ error: 3 })
      throw 3
    }
    return null
  }
  static isErr(e, code, res, cb) {
    if (e != null) {
      res.send({ error: 2 })
    } else {
      cb()
    }
  }
  static setAccess(type, uid) {
    access[type][uid] = Date.now()
  }

  static checkRandom_Value(user_id, random_value, res) {
    return firestore
      .collection("users")
      .doc(user_id)
      .get()
      .then(ss => {
        if (
          ss.exists == false ||
          ss.data().random_value == undefined ||
          ss.data().random_value != random_value
        ) {
          throw 3
        }
        return null
      })
  }
}

for (let v of ["get", "post"]) {
  app[v]("/*", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Headers", "X-Requested-With")
    next()
  })
}

app.get("/alishackers/check/following/:target_id", async (req, res) => {
  const target = req.params.target_id
  util.isTooShort("following", target, res)
  try {
    let d = await util.getFriendship(target)
    util.setAccess("following", target)
    let following = null
    try {
      following = d.relationship.target.following
    } catch (e) {
      console.log(e)
      return res.send({ error: 1 })
    }
    return res.send({ following: following })
  } catch (e) {
    console.log(e)
    return res.send({ error: 1 })
  }
})

app.get("/alishackers/check/discord/:id/:discord_id", async (req, res) => {
  try {
    const userid = req.params.id
    const discord_id = req.params.discord_id
    util.isTooShort("discord", userid, res)
    let discord_cred = await util.getDiscordUserFromPool(discord_id)
    const access_token = discord_cred.tokens.access_token
    const guilds = await util.getUserGuilds(access_token)
    let isMember = false
    for (let v of guilds) {
      if (v.id === process.env.DISCORD_CHANNEL_ID) {
        isMember = true
        break
      }
    }
    res.send({ isMember: isMember })
  } catch (e) {
    console.log(e)
    res.send({ error: 2 })
  }
})

app.post("/alishackers/remove/discord/:uid/:random_value", async (req, res) => {
  try {
    await util.checkRandom_Value(req.params.uid, req.params.random_value)
    const cred = await util.getCredentials(req.params.uid)
    if (cred.discord != undefined && cred.discord.id != undefined) {
      await util.removeDiscordUserFromPool(cred.discord)
    }
    await util.removeDiscordUser(req.params.uid)
    res.send({ error: null })
  } catch (e) {
    res.send({ error: 2 })
  }
})

app.get("/oauth/discord", async (req, res) => {
  try {
    let [random_value, user_id] = req.query.state.split("_")
    await util.checkRandom_Value(user_id, random_value)
    let tokens = await util.getDiscordTokens(req.query.code)
    let discord_user = await util.getDiscordUser(tokens.access_token)
    if (await util.existsDiscordUser(discord_user)) {
      return res.redirect(`${process.env.FRONTEND_ORIGIN}/home?error=1`)
    } else {
      await util.setDiscordUser(user_id, discord_user)
      discord_user.tokens = tokens
      await util.addDiscordUserToPool(discord_user)
    }
  } catch (e) {
    console.log(e)
  }
  res.redirect(`${process.env.FRONTEND_ORIGIN}/home`)
})

app.listen(PORT, () => console.log(`Listening on ${PORT}`))
