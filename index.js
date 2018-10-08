require("dotenv").config()
const PORT = process.env.PORT || 5000
const alis = require("alis")
const rp = require("request-promise")
const simple_oauth2 = require("simple-oauth2")
const express = require("express")
const bodyParser = require("body-parser")
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
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

let access = { following: {}, discord: {} }

class util {
  static async updateMagazinArticle(article, mid, uid) {
    try {
      article.removed = false
      await firestore
        .collection("magazines")
        .doc(mid)
        .collection("articles")
        .doc(article.article_id)
        .update(article)
    } catch (e) {
      await firestore
        .collection("magazines")
        .doc(mid)
        .collection("articles")
        .doc(article.article_id)
        .set(article)
    }
    let ss = await firestore
      .collection("users_server")
      .doc(uid)
      .collection("magazine_articles")
      .doc(article.article_id)
      .get()
    let magazine = {}
    if (ss.exists) {
      magazine = ss.data() || {}
    }
    magazine["admin"] = {
      title: "ハッカーマガジン"
    }
    await firestore
      .collection("users_server")
      .doc(uid)
      .collection("magazine_articles")
      .doc(article.article_id)
      .set(magazine)
    await firestore
      .collection("magazines_pool")
      .doc("admin")
      .set({ date: Date.now() })
  }
  static async getUserAmount(uid) {
    let ss = await firestore
      .collection("users_server")
      .doc(uid)
      .get()
    let user = ss.data()
    let user_amount
    if (user != undefined && user.amount != undefined) {
      user_amount = user.amount
    }
    if (user_amount == undefined) {
      user_amount = { aht: { paid: 0, earned: 0, tip: 0, tipped: 0 } }
    }
    return user_amount
  }
  static async tipArticle(article, amount, uid) {
    amount *= 1
    let date = Date.now()
    await firestore
      .collection("tip_pool")
      .doc(`${article.article_id}_${uid}_${date}`)
      .set({
        magazine: "admin",
        processed: false,
        article_id: article.article_id,
        uid: uid,
        article_uid: article.uid,
        amount: amount,
        date: date
      })
    let user_amount = await this.getUserAmount(uid)
    if (user_amount.aht.tip == undefined) {
      user_amount.aht.tip = 0
    }
    let divider = 100000000
    user_amount.aht.tip =
      Math.round((user_amount.aht.tip + amount) * divider) / divider
    await firestore
      .collection("users_server")
      .doc(uid)
      .update({
        amount: user_amount
      })
    console.log(user_amount)
    let user_amount2 = await this.getUserAmount(article.uid)
    if (user_amount2.aht.tipped == undefined) {
      user_amount2.aht.tipped = 0
    }
    user_amount2.aht.tipped =
      Math.round((user_amount2.aht.tipped + amount) * divider) / divider
    await firestore
      .collection("users_server")
      .doc(article.uid)
      .update({
        amount: user_amount2
      })
    await firestore
      .collection("users")
      .doc(article.uid)
      .collection("history")
      .doc(`${date}_tip`)
      .set({
        date: date,
        amount: amount,
        article: _(article).pick(["title", "user_id", "article_id"]),
        type: "tip"
      })
    await firestore
      .collection("users")
      .doc(uid)
      .collection("tip")
      .doc(`${date}`)
      .set({
        date: date,
        amount: amount,
        to: article.uid,
        article: _(article).pick([
          "title",
          "user_id",
          "article_id",
          "user_display_name",
          "icon_image_url"
        ])
      })
  }
  static async unpublishMagazineArticle(article, mid, uid) {
    await firestore
      .collection("magazines")
      .doc(mid)
      .collection("articles")
      .doc(article.article_id)
      .update({ removed: Date.now() })
    let ss = await firestore
      .collection("users_server")
      .doc(uid)
      .collection("magazine_articles")
      .doc(article.article_id)
      .get()
    let magazine = {}
    if (ss.exists) {
      magazine = ss.data() || {}
    }
    delete magazine["admin"]
    await firestore
      .collection("users_server")
      .doc(uid)
      .collection("magazine_articles")
      .doc(article.article_id)
      .set(magazine)
    await firestore
      .collection("magazines_pool")
      .doc("admin")
      .set({ date: Date.now() })
  }

  static async registerHistory(payment) {
    return await firestore
      .collection("history")
      .doc(`${payment.date}_${payment.to}_admin`)
      .set({
        amount: payment.amount,
        type: payment.type,
        payment_from: "admin",
        payment_to: payment.to,
        reason: payment.what_for,
        photoURL: payment.photoURL,
        displayName: payment.displayName,
        uid: payment.to,
        date: payment.date
      })
  }
  static async addToUserHistory(payment) {
    await firestore
      .collection("users")
      .doc(payment.to)
      .collection("history")
      .doc(`${payment.date}_${payment.type}`)
      .set({
        amount: payment.amount,
        type: payment.type,
        payment_from: "admin",
        payment_to: payment.to,
        reason: payment.what_for,
        photoURL: payment.photoURL,
        displayName: payment.displayName,
        uid: payment.to,
        date: payment.date
      })
    let user = await firestore
      .collection("users_server")
      .doc(payment.to)
      .get()
      .then(ss => {
        return ss.data()
      })
    if (user == undefined) {
      let amount = { aht: { paid: 0, earned: payment.amount } }
      await firestore
        .collection("users_server")
        .doc(payment.to)
        .set({
          amount: amount
        })
    } else {
      let amount = user.amount || {}
      if (amount.aht == undefined) {
        amount.aht = { paid: 0, earned: 0 }
      }
      let divider = 100000000
      amount.aht.earned =
        Math.round((amount.aht.earned + payment.amount) * divider) / divider
      await firestore
        .collection("users_server")
        .doc(payment.to)
        .update({
          amount: amount
        })
    }
  }

  static async existsDiscordUser(user) {
    let ss = await firestore
      .collection("discord_pool")
      .doc(user.id)
      .get()
    return ss.exists
  }
  static async existsALISUser(user) {
    let ss = await firestore
      .collection("alis_pool")
      .doc(user.user_id)
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

  static async addALISUserToPool(user) {
    return await firestore
      .collection("alis_pool")
      .doc(user.user_id)
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

  static async removeALISUserFromPool(user) {
    return await firestore
      .collection("alis_pool")
      .doc(user.user_id)
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

  static async removeALISUser(uid) {
    return await firestore
      .collection("users_server")
      .doc(uid)
      .update({
        alis: admin.firestore.FieldValue.delete(),
        is_alis: admin.firestore.FieldValue.delete()
      })
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

  static async setALISUser(uid, user) {
    try {
      await firestore
        .collection("users_server")
        .doc(uid)
        .update({ is_alis: true, alis: user, is_alis_init: false })
    } catch (e) {
      await firestore
        .collection("users_server")
        .doc(uid)
        .set({ is_alis: true, alis: user, is_alis_init: false })
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

  static checkAdmin(twitter_id) {
    return (
      process.env.ADMIN_TWITTER_ID != undefined &&
      process.env.ADMIN_TWITTER_ID === twitter_id
    )
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

app.post("/alishackers/payment", async (req, res) => {
  try {
    await util.checkRandom_Value(req.body.uid, req.body.random_value)
    if (util.checkAdmin(req.body.twitter_id) !== true) {
      throw "not admin"
    }
    let payment_date = Date.now()
    let payment = {
      photoURL: req.body.photoURL,
      displayName: req.body.displayName,
      date: payment_date,
      to: req.body.to,
      amount: req.body.amount * 1,
      what_for: req.body.what_for,
      type: req.body.type
    }
    await util.registerHistory(payment)
    await util.addToUserHistory(payment)
    res.send({ error: null })
  } catch (e) {
    console.log(e)
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

app.get("/alishackers/users/list", async (req, res) => {
  let listUsersResult = await admin.auth().listUsers(100)
  let users = listUsersResult.users.map(userRecord => {
    return userRecord.toJSON()
  })
  res.send({ users: users })
})
app.get("/alishackers/get_user/:user_id", async (req, res) => {
  try {
    let user = await alis.p.users.user_id.info({ user_id: req.params.user_id })
    res.send({ user: user })
  } catch (e) {
    res.send({ error: e })
  }
})

app.post("/alishackers/auth/alis/", async (req, res) => {
  try {
    let { random_value, uid, token } = req.body
    await util.checkRandom_Value(uid, random_value)

    let user = await alis.p.me.info({}, { id_token: token })
    if (user == undefined || user.user_id == undefined) {
      res.send({ error: 3 })
    } else if (await util.existsALISUser(user)) {
      res.send({ error: 4, user: user })
    } else {
      await util.setALISUser(uid, user)
      await util.addALISUserToPool(user)

      res.send({ error: null, user: user })
    }
  } catch (e) {
    console.log(e)
    res.send({ error: 2 })
  }
})

app.post("/alishackers/remove/alis/:uid/:random_value", async (req, res) => {
  try {
    await util.checkRandom_Value(req.params.uid, req.params.random_value)
    const cred = await util.getCredentials(req.params.uid)
    if (cred.alis != undefined && cred.alis.user_id != undefined) {
      await util.removeALISUserFromPool(cred.alis)
    }
    await util.removeALISUser(req.params.uid)
    res.send({ error: null })
  } catch (e) {
    res.send({ error: 2 })
  }
})
app.get("/alishackers/list/articles/:uid/:user_id", async (req, res) => {
  try {
    let articles = await alis.p.users.user_id.articles.public({
      user_id: req.params.user_id
    })
    res.send({ articles: articles.Items })
  } catch (e) {
    console.log(e)
    res.send({ error: 2 })
  }
})
app.post("/alishackers/upload/article/", async (req, res) => {
  try {
    await util.checkRandom_Value(req.body.uid, req.body.random_value)
    let article = JSON.parse(req.body.article)
    let uid = req.body.uid
    let mid = req.body.mid
    article.uid = uid
    await util.updateMagazinArticle(article, mid, uid)
    res.send({ articles: req.body.article })
  } catch (e) {
    console.log(e)
    res.send({ error: 2 })
  }
})
app.post("/alishackers/unpublish/article/", async (req, res) => {
  try {
    await util.checkRandom_Value(req.body.uid, req.body.random_value)
    let article = JSON.parse(req.body.article)
    let uid = req.body.uid
    let mid = req.body.mid
    article.uid = uid
    await util.unpublishMagazineArticle(article, mid, uid)
    res.send({ articles: req.body.article })
  } catch (e) {
    console.log(e)
    res.send({ error: 2 })
  }
})
app.post("/alishackers/tip/", async (req, res) => {
  try {
    await util.checkRandom_Value(req.body.uid, req.body.random_value)
    let article = JSON.parse(req.body.article)
    let uid = req.body.uid
    let amount = req.body.amount
    await util.tipArticle(article, amount, uid)
    res.send({ amount: amount })
  } catch (e) {
    console.log(e)
    res.send({ error: 2 })
  }
})

app.listen(PORT, () => console.log(`Listening on ${PORT}`))
