const alis = require("alis")
const util = require("./util")

let routes = [
  {
    route: "/check/magazine_id",
    method: "post",
    func: async (req, res) => {
      try {
        let id = req.body.magazine_id.toLowerCase()
        let exists = await util.checkMagazineID(req.PREFIX, id)
        res.send({ exists: exists })
      } catch (e) {
        console.log(e)
        res.send({ error: 2 })
      }
    }
  },
  {
    route: "/magazine/issue/:uid/:random_value",
    method: "post",
    func: async (req, res) => {
      try {
        await util.checkRandom_Value(
          req.PREFIX,
          req.params.uid,
          req.params.random_value
        )
        let exists = false
        if (req.body.set_id === "true") {
          exists = await util.checkMagazineID(
            req.PREFIX,
            req.body.url_id.toLowerCase()
          )
        }
        if (exists) {
          res.send({ error: 3 })
        } else {
          let magazine = {
            editors: req.body.editors,
            id: req.body.id,
            title: req.body.title,
            owner: req.body.owner,
            created_at: Date.now()
          }
          if (req.body.description != undefined) {
            magazine.description = req.body.description
          }
          if (req.body.url_id != undefined) {
            magazine.url_id = req.body.url_id.toLowerCase()
            magazine.url_id_original = req.body.url_id
          }

          let file_id
          if (req.body.is_edit === "true") {
            file_id = req.body.file_id
            await util.updateMagazine(req.PREFIX, file_id)
          } else {
            file_id = await util.dropMagazine(magazine)
          }
          magazine.file_id = file_id
          if (req.body.set_id === "true") {
            await util.addMagazineID(req.PREFIX, magazine)
          }
          await util.addMagazine(req.PREFIX, magazine)
          await util.addMagazineToUser(req.PREFIX, magazine)
          res.send(magazine)
        }
      } catch (e) {
        console.log(e)
        res.send({ error: 2 })
      }
    }
  },
  {
    route: "/magazine/delete/:uid/:random_value",
    method: "post",
    func: async (req, res) => {
      try {
        await util.checkRandom_Value(
          req.PREFIX,
          req.params.uid,
          req.params.random_value
        )
        let magazine = {
          editors: req.body.editors,
          id: req.body.id,
          title: req.body.title,
          owner: req.body.owner,
          created_at: Date.now()
        }
        if (req.body.description != undefined) {
          magazine.description = req.body.description
        }
        let file_id = req.body.file_id
        magazine.file_id = file_id
        magazine.deleted = Date.now()
        await util.dropMagazine(magazine)
        await util.deleteMagazine(req.PREFIX, magazine)
        await util.deleteMagazineToUser(req.PREFIX, magazine)
        res.send(magazine)
      } catch (e) {
        console.log(e)
        res.send({ error: 2 })
      }
    }
  },
  {
    route: "/check/following/:target_id",
    func: async (req, res) => {
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
    }
  },
  {
    route: "/check/discord/:id/:discord_id",
    func: async (req, res) => {
      try {
        const userid = req.params.id
        const discord_id = req.params.discord_id
        util.isTooShort("discord", userid, res)
        let discord_cred = await util.getDiscordUserFromPool(
          req.PREFIX,
          discord_id
        )
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
    }
  },
  {
    route: "/remove/discord/:uid/:random_value",
    method: "post",
    func: async (req, res) => {
      try {
        await util.checkRandom_Value(
          req.PREFIX,
          req.params.uid,
          req.params.random_value
        )
        const cred = await util.getCredentials(req.PREFIX, req.params.uid)
        if (cred.discord != undefined && cred.discord.id != undefined) {
          await util.removeDiscordUserFromPool(req.PREFIX, cred.discord)
        }
        await util.removeDiscordUser(req.params.uid)
        res.send({ error: null })
      } catch (e) {
        res.send({ error: 2 })
      }
    }
  },
  {
    route: "/payment",
    method: "post",
    func: async (req, res) => {
      try {
        await util.checkRandom_Value(
          req.PREFIX,
          req.body.uid,
          req.body.random_value
        )
        if (util.checkAdmin(req.body.twitter_id) !== true) {
          if (req.PREFIX !== "testnet" || req.body.type != "faucet") {
            throw "not admin"
          }
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
        await util.registerHistory(req.PREFIX, payment)
        await util.addToUserHistory(req.PREFIX, payment)
        res.send({ error: null })
      } catch (e) {
        console.log(e)
        res.send({ error: 2 })
      }
    }
  },
  {
    route: "/oauth/discord",
    func: async (req, res) => {
      try {
        let [random_value, user_id] = req.query.state.split("_")
        await util.checkRandom_Value(req.PREFIX, user_id, random_value)
        let tokens = await util.getDiscordTokens(req.PREFIX, req.query.code)
        let discord_user = await util.getDiscordUser(tokens.access_token)
        if (await util.existsDiscordUser(req.PREFIX, discord_user)) {
          return res.redirect(`${process.env.FRONTEND_ORIGIN}/home?error=1`)
        } else {
          await util.setDiscordUser(req.PREFIX, user_id, discord_user)
          discord_user.tokens = tokens
          await util.addDiscordUserToPool(req.PREFIX, discord_user)
        }
      } catch (e) {
        console.log(e)
      }
      res.redirect(`${process.env.FRONTEND_ORIGIN}/home`)
    }
  },
  {
    route: "/users/list",
    func: async (req, res) => {
      let listUsersResult = await util.listUsers(req.PREFIX)
      let users = listUsersResult.users.map(userRecord => {
        return userRecord.toJSON()
      })
      res.send({ users: users })
    }
  },
  {
    route: "/get_user/:user_id",
    func: async (req, res) => {
      try {
        let user = await alis.p.users.user_id.info({
          user_id: req.params.user_id
        })
        res.send({ user: user })
      } catch (e) {
        res.send({ error: e })
      }
    }
  },
  {
    route: "/auth/alis/",
    method: "post",
    func: async (req, res) => {
      try {
        let { random_value, uid, token } = req.body
        await util.checkRandom_Value(req.PREFIX, uid, random_value)

        let user = await alis.p.me.info({}, { id_token: token })
        if (user == undefined || user.user_id == undefined) {
          res.send({ error: 3 })
        } else if (await util.existsALISUser(req.PREFIX, user)) {
          res.send({ error: 4, user: user })
        } else {
          user.uid = uid
          await util.setALISUser(req.PREFIX, uid, user)
          await util.addALISUserToPool(req.PREFIX, user)

          res.send({ error: null, user: user })
        }
      } catch (e) {
        console.log(e)
        res.send({ error: 2 })
      }
    }
  },
  {
    route: "/remove/alis/:uid/:random_value",
    method: "post",
    func: async (req, res) => {
      try {
        await util.checkRandom_Value(
          req.PREFIX,
          req.params.uid,
          req.params.random_value
        )
        const cred = await util.getCredentials(req.PREFIX, req.params.uid)
        if (cred.alis != undefined && cred.alis.user_id != undefined) {
          await util.removeALISUserFromPool(req.PREFIX, cred.alis)
        }
        await util.removeALISUser(req.PREFIX, req.params.uid)
        res.send({ error: null })
      } catch (e) {
        res.send({ error: 2 })
      }
    }
  },
  {
    route: "/list/articles/:uid/:user_id",
    method: "post",
    func: async (req, res) => {
      try {
        let articles = {}
        if (req.body.search == "search") {
          let obj = {
            query: req.params.user_id
          }
          if (req.body["LastEvaluatedKey"] != undefined) {
            obj.page = req.body["LastEvaluatedKey"]
          }
          let result = await alis.p.search.articles(obj)
          articles.Items = result
        } else if (req.body.search == "tag") {
          let obj = {
            tag: req.params.user_id
          }

          if (req.body["LastEvaluatedKey"] != undefined) {
            obj.page = req.body["LastEvaluatedKey"]
          }
          let result = await alis.p.search.articles(obj)
          articles.Items = result
        } else if (req.body.search == "id") {
          let obj = {
            article_id: req.params.user_id
          }

          let article = await alis.p.articles.article_id(obj)
          if (article != undefined) {
            delete article.body
            articles.Items = [article]
          } else {
            res.send({ error: 4 })
            return
          }
        } else {
          let obj = {
            user_id: req.params.user_id
          }

          if (req.body["LastEvaluatedKey[sort_key]"] != undefined) {
            obj.sort_key = req.body["LastEvaluatedKey[sort_key]"]
            obj.article_id = req.body["LastEvaluatedKey[article_id]"]
          }
          articles = await alis.p.users.user_id.articles.public(obj)
        }
        res.send({
          articles: articles.Items,
          LastEvaluatedKey: articles.LastEvaluatedKey
        })
      } catch (e) {
        console.log(e)
        res.send({ error: 2 })
      }
    }
  },
  {
    route: "/upload/article/",
    method: "post",
    func: async (req, res) => {
      try {
        await util.checkRandom_Value(
          req.PREFIX,
          req.body.uid,
          req.body.random_value
        )
        let article = JSON.parse(req.body.article)
        let uid = req.body.uid
        let mid = req.body.mid
        article.uid = uid
        await util.updateMagazineArticle(req.PREFIX, article, mid, uid)
        res.send({ articles: req.body.article })
      } catch (e) {
        console.log(e)
        res.send({ error: 2 })
      }
    }
  },
  {
    route: "/unpublish/article/",
    method: "post",
    func: async (req, res) => {
      try {
        await util.checkRandom_Value(
          req.PREFIX,
          req.body.uid,
          req.body.random_value
        )
        let article = JSON.parse(req.body.article)
        let uid = req.body.uid
        let mid = req.body.mid
        article.uid = uid
        await util.unpublishMagazineArticle(req.PREFIX, article, mid, uid)
        res.send({ articles: req.body.article })
      } catch (e) {
        console.log(e)
        res.send({ error: 2 })
      }
    }
  },
  {
    route: "/tip/",
    method: "post",
    func: async (req, res) => {
      try {
        await util.checkRandom_Value(
          req.PREFIX,
          req.body.uid,
          req.body.random_value
        )
        let article = JSON.parse(req.body.article)
        let uid = req.body.uid
        let amount = req.body.amount
        let tip = await util.tipArticle(
          req.PREFIX,
          article,
          amount,
          uid,
          req.body.magazine_id
        )
        res.send({ tip: tip, amount: amount })
      } catch (e) {
        console.log(e)
        res.send({ error: 2 })
      }
    }
  }
]
class Routes {
  constructor(namespace = "alishackers") {
    this.namespace = namespace
    this.routes = routes
    this.initUtil()
  }
  initUtil() {
    util.init(this.namespace)
  }
}

module.exports = Routes
