const _ = require("underscore")
const rp = require("request-promise")

// discord OAuth
const simple_oauth2 = require("simple-oauth2")
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

// twitter API
const Twit = require("twit")
let T = new Twit({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token: process.env.TWITTER_ACCESS_TOKEN,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
  timeout_ms: 60 * 1000
})

// firestore
const admin = require("firebase-admin")

let firestore = {}
let app = {}
let access = { following: {}, discord: {} }

//dropbox
const Dropbox = require("dropbox").Dropbox
let dropbox_credentials
let dropbox

class util {
  static init(v) {
    let prefix_sa = ""
    let prefix = ""
    if (v !== "alishackers") {
      prefix_sa = `.${v}`
      prefix = `__${v.toUpperCase()}__`
    }
    let serviceAccount
    try {
      serviceAccount = require("./.service-account" + prefix_sa + ".json")
    } catch (e) {
      serviceAccount = require("../.service-account" + prefix_sa + ".json")
    }
    app[v] = admin.initializeApp(
      {
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env[`${prefix}FIRESTORE_DATABASE_URL`]
      },
      v
    )
    firestore[v] = admin.firestore(app[v])
    firestore[v].settings({ timestampsInSnapshots: true })
    dropbox_credentials = {
      app_key: process.env[`${prefix}DROPBOX_APP_KEY`],
      app_secret: process.env[`${prefix}DROPBOX_APP_SECRET`],
      app_access_token: process.env[`${prefix}DROPBOX_APP_ACCESS_TOKEN`]
    }
    dropbox = new Dropbox({
      accessToken: dropbox_credentials.app_access_token
    })
  }
  static async updateMagazine(prefix, file_id) {
    await firestore[prefix]
      .collection("magazines_updates")
      .doc(file_id)
      .set({ date: Date.now() })
  }
  static async checkMagazineID(prefix, id) {
    if (id.toLowerCase() === "admin") {
      return true
    } else {
      let ss = await firestore[prefix]
        .collection("magazines_ids")
        .doc(id)
        .get()
      return ss.exists
    }
  }
  static async addMagazineID(prefix, magazine) {
    let obj = {}
    for (let v of ["id", "file_id", "url_id", "url_id_original"]) {
      if (magazine[v] != undefined) {
        obj[v] = magazine[v]
      }
    }
    let ss = await firestore[prefix]
      .collection("magazines_ids")
      .doc(magazine.url_id)
      .set(obj)
  }
  static async addMagazine(prefix, magazine) {
    try {
      await firestore[prefix]
        .collection("magazines")
        .doc(magazine.file_id)
        .update(magazine)
    } catch (e) {
      await firestore[prefix]
        .collection("magazines")
        .doc(magazine.file_id)
        .set(magazine)
    }
  }
  static async deleteMagazine(prefix, magazine) {
    try {
      await firestore[prefix]
        .collection("magazines")
        .doc(magazine.file_id)
        .update(magazine)
    } catch (e) {}
  }

  static async addMagazineToUser(prefix, magazine) {
    try {
      await firestore[prefix]
        .collection("users_server")
        .doc(magazine.owner)
        .collection("magazines")
        .doc(magazine.file_id)
        .update(magazine)
    } catch (e) {
      await firestore[prefix]
        .collection("users_server")
        .doc(magazine.owner)
        .collection("magazines")
        .doc(magazine.file_id)
        .set(magazine)
    }
  }
  static async deleteMagazineToUser(prefix, magazine) {
    try {
      await firestore[prefix]
        .collection("users_server")
        .doc(magazine.owner)
        .collection("magazines")
        .doc(magazine.file_id)
        .update(magazine)
    } catch (e) {}
  }

  static async dropMagazine(magazine) {
    const file_path = `/magazines/${magazine.id}.json`
    await dropbox.filesUpload({
      path: file_path,
      contents: JSON.stringify(magazine),
      mode: "overwrite"
    })
    const result = await dropbox.sharingCreateSharedLink({
      path: file_path,
      short_url: false
    })
    const file_url = result.url.replace(/\?dl=0$/, "")
    const file_id = file_url.split("/")[4]
    return file_id
  }
  static async listUsers(prefix) {
    return await admin.auth(app[prefix]).listUsers(100)
  }
  static async updateMagazineArticle(prefix, article, mid, uid) {
    try {
      article.removed = false
      await firestore[prefix]
        .collection("magazines")
        .doc(mid)
        .collection("articles")
        .doc(article.article_id)
        .update(article)
    } catch (e) {
      await firestore[prefix]
        .collection("magazines")
        .doc(mid)
        .collection("articles")
        .doc(article.article_id)
        .set(article)
    }
    let ss = await firestore[prefix]
      .collection("users_server")
      .doc(uid)
      .collection("magazine_articles")
      .doc(article.article_id)
      .get()
    let magazine = {}
    if (ss.exists) {
      magazine = ss.data() || {}
    }
    magazine[mid] = {
      date: Date.now()
    }
    await firestore[prefix]
      .collection("users_server")
      .doc(uid)
      .collection("magazine_articles")
      .doc(article.article_id)
      .set(magazine)
    await firestore[prefix]
      .collection("magazines_pool")
      .doc(mid)
      .set({ date: Date.now() })
  }
  static async getUserAmount(prefix, uid, asset = "aht") {
    let ss = await firestore[prefix]
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
    if (user_amount[asset] == undefined) {
      let asset_ss = await firestore[prefix]
        .collection("assets")
        .doc(asset)
        .get()
      user_amount[asset] = { paid: 0, earned: 0, tip: 0, tipped: 0 }
      if (asset_ss.exists) {
        let asset_data = asset_ss.data()
        user_amount[asset].name = asset_data.name
      }
    }
    return user_amount
  }
  static async tipArticle(
    prefix,
    article,
    amount,
    uid,
    magazine_id,
    asset = "aht"
  ) {
    let ss = await firestore[prefix]
      .collection("alis_pool")
      .doc(article.user_id)
      .get()
    let alisista
    if (ss.exists == false || ss.data().uid == undefined) {
      return false
    } else {
      alisista = ss.data().uid
    }
    amount *= 1
    let date = Date.now()
    let user_amount = await this.getUserAmount(prefix, uid, asset)
    let asset_name = user_amount[asset].name || "AHT"
    await firestore[prefix]
      .collection("tip_pool")
      .doc(`${article.article_id}_${uid}_${date}`)
      .set({
        magazine: magazine_id,
        processed: false,
        article_id: article.article_id,
        uid: uid,
        article_uid: alisista,
        amount: amount,
        date: date,
        asset: asset,
        asset_name: asset_name
      })
    if (user_amount[asset].tip == undefined) {
      user_amount[asset].tip = 0
    }
    let divider = 100000000
    user_amount[asset].tip =
      Math.round((user_amount[asset].tip + amount) * divider) / divider
    await firestore[prefix]
      .collection("users_server")
      .doc(uid)
      .update({
        amount: user_amount
      })
    let user_amount2 = await this.getUserAmount(prefix, alisista, asset)
    if (user_amount2[asset].tipped == undefined) {
      user_amount2[asset].tipped = 0
    }
    user_amount2[asset].tipped =
      Math.round((user_amount2[asset].tipped + amount) * divider) / divider
    await firestore[prefix]
      .collection("users_server")
      .doc(alisista)
      .update({
        amount: user_amount2
      })
    await firestore[prefix]
      .collection("users")
      .doc(alisista)
      .collection("history")
      .doc(`${date}_tip`)
      .set({
        asset_name: asset_name,
        asset: asset,
        date: date,
        amount: amount,
        magazine_id: magazine_id,
        article: _(article).pick(["title", "user_id", "article_id"]),
        type: "tip"
      })
    await firestore[prefix]
      .collection("users")
      .doc(uid)
      .collection("tip")
      .doc(`${date}`)
      .set({
        asset_name: asset_name,
        asset: asset,
        date: date,
        amount: amount,
        magazine_id: magazine_id,
        to: alisista,
        article: _(article).pick([
          "title",
          "user_id",
          "article_id",
          "user_display_name",
          "icon_image_url"
        ])
      })
    return true
  }
  static async unpublishMagazineArticle(prefix, article, mid, uid) {
    await firestore[prefix]
      .collection("magazines")
      .doc(mid)
      .collection("articles")
      .doc(article.article_id)
      .update({ removed: Date.now() })
    let ss = await firestore[prefix]
      .collection("users_server")
      .doc(uid)
      .collection("magazine_articles")
      .doc(article.article_id)
      .get()
    let magazine = {}
    if (ss.exists) {
      magazine = ss.data() || {}
    }
    delete magazine[mid]
    await firestore[prefix]
      .collection("users_server")
      .doc(uid)
      .collection("magazine_articles")
      .doc(article.article_id)
      .set(magazine)
    await firestore[prefix]
      .collection("magazines_pool")
      .doc(mid)
      .set({ date: Date.now() })
  }

  static async registerHistory(prefix, payment) {
    return await firestore[prefix]
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
  static async addToUserHistory(prefix, payment) {
    await firestore[prefix]
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
    let user = await firestore[prefix]
      .collection("users_server")
      .doc(payment.to)
      .get()
      .then(ss => {
        return ss.data()
      })
    if (user == undefined) {
      let amount = { aht: { paid: 0, earned: payment.amount } }
      await firestore[prefix]
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
      await firestore[prefix]
        .collection("users_server")
        .doc(payment.to)
        .update({
          amount: amount
        })
    }
  }

  static async existsDiscordUser(prefix, user) {
    let ss = await firestore[prefix]
      .collection("discord_pool")
      .doc(user.id)
      .get()
    return ss.exists
  }

  static async existsALISUser(prefix, user) {
    let ss = await firestore[prefix]
      .collection("alis_pool")
      .doc(user.user_id)
      .get()
    return ss.exists
  }

  static async getDiscordUserFromPool(prefix, userid) {
    let ss = await firestore[prefix]
      .collection("discord_pool")
      .doc(userid)
      .get()
    return ss.data()
  }

  static async addDiscordUserToPool(prefix, user) {
    return await firestore[prefix]
      .collection("discord_pool")
      .doc(user.id)
      .set(user)
      .catch(e => {
        console.log(e)
      })
  }

  static async addALISUserToPool(prefix, user) {
    return await firestore[prefix]
      .collection("alis_pool")
      .doc(user.user_id)
      .set(user)
      .catch(e => {
        console.log(e)
      })
  }

  static async removeDiscordUserFromPool(prefix, user) {
    return await firestore[prefix]
      .collection("discord_pool")
      .doc(user.id)
      .delete()
      .catch(e => {
        console.log(e)
      })
  }

  static async removeALISUserFromPool(prefix, user) {
    return await firestore[prefix]
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

  static async getCredentials(prefix, userid) {
    let ss = await firestore[prefix]
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

  static async removeDiscordUser(prefix, uid) {
    return await firestore[prefix]
      .collection("users_server")
      .doc(uid)
      .update({ discord: admin.firestore.FieldValue.delete() })
  }

  static async removeALISUser(prefix, uid) {
    return await firestore[prefix]
      .collection("users_server")
      .doc(uid)
      .update({
        alis: admin.firestore.FieldValue.delete(),
        is_alis: admin.firestore.FieldValue.delete()
      })
  }

  static async setDiscordUser(prefix, uid, user) {
    try {
      await firestore[prefix]
        .collection("users_server")
        .doc(uid)
        .update({ discord: user })
    } catch (e) {
      await firestore[prefix]
        .collection("users_server")
        .doc(uid)
        .set({ discord: user })
    }
    return
  }

  static async setALISUser(prefix, uid, user) {
    try {
      await firestore[prefix]
        .collection("users_server")
        .doc(uid)
        .update({ is_alis: true, alis: user, is_alis_init: false })
    } catch (e) {
      await firestore[prefix]
        .collection("users_server")
        .doc(uid)
        .set({ is_alis: true, alis: user, is_alis_init: false })
    }
    return
  }

  static async getDiscordTokens(prefix, code) {
    return await oauth2_discord.authorizationCode.getToken({
      code: code,
      redirect_uri: `${
        process.env.BACKEND_SERVER_ORIGIN
      }/${prefix}/oauth/discord`
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

  static checkRandom_Value(prefix, user_id, random_value, res) {
    return firestore[prefix]
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

module.exports = util
