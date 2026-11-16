' HallFlix on Roku: sign-in, home rows with library tiles, libraries, title pages and playback with pre-rolls.

sub init()
    m.reg = CreateObject("roRegistrySection", "hallflix")
    m.server = m.reg.Read("server")
    m.token = m.reg.Read("token")
    m.tasks = {}
    m.taskId = 0
    m.screen = ""
    m.back = []
    m.accent = "0x35D0D0FF"

    m.bg = m.top.findNode("bg")
    m.backdrop = m.top.findNode("backdrop")
    m.logo = m.top.findNode("logo")
    m.status = m.top.findNode("status")
    m.spinner = m.top.findNode("spinner")
    m.spinner.poster.uri = "pkg:/images/spinner.png"
    m.spinner.poster.width = 96
    m.spinner.poster.height = 96

    m.home = m.top.findNode("home")
    m.rows = m.top.findNode("rows")
    m.rows.observeField("rowItemFocused", "onRowFocus")
    m.rows.observeField("rowItemSelected", "onRowSelect")

    m.library = m.top.findNode("library")
    m.grid = m.top.findNode("grid")
    m.grid.observeField("itemSelected", "onGridSelect")
    m.grid.observeField("itemFocused", "onGridFocus")

    m.details = m.top.findNode("details")
    m.buttons = m.top.findNode("buttons")
    m.buttons.observeField("buttonSelected", "onButton")
    m.seasons = m.top.findNode("seasons")
    m.seasons.observeField("itemFocused", "onSeasonFocus")
    m.episodes = m.top.findNode("episodes")
    m.episodes.observeField("itemSelected", "onEpisodeSelect")

    m.profiles = m.top.findNode("profiles")
    m.profileList = m.top.findNode("profileList")
    m.profileList.observeField("itemSelected", "onProfileSelect")

    m.video = m.top.findNode("video")
    m.video.observeField("state", "onVideoState")
    m.video.observeField("contentIndex", "onVideoIndex")
    m.video.observeField("position", "onVideoPosition")
    m.badge = m.top.findNode("badge")
    m.ping = m.top.findNode("ping")
    m.ping.observeField("fire", "onPing")

    m.logo.uri = "pkg:/images/logo.png"
    if m.server = "" then askServer() else boot()
end sub

' ---------- talking to the server ----------
function api(kind as string, method as string, path as string, body = invalid as dynamic, extra = invalid as dynamic) as object
    m.taskId = m.taskId + 1
    t = CreateObject("roSGNode", "ApiTask")
    req = { id: m.taskId.ToStr(), kind: kind, server: m.server, token: m.token, method: method, path: path, body: body }
    if extra <> invalid then req.Append(extra)
    t.request = req
    t.observeField("response", "onApi")
    m.tasks[req.id] = t
    t.control = "RUN"
    return t
end function

sub onApi(msg as object)
    t = msg.getRoSGNode()
    req = t.request
    r = msg.getData()
    m.tasks.Delete(req.id)
    k = req.kind
    if k = "boot" then
        onBoot(r)
    else if k = "login" then
        onLogin(r)
    else if k = "home" then
        onHome(r)
    else if k = "library" then
        onLibrary(r)
    else if k = "item" then
        onItem(r)
    else if k = "play" then
        onPlay(r)
    end if
end sub

function img(url as dynamic) as string
    if url = invalid or url = "" then return ""
    if Left(url, 4) = "http" then return url
    sep = "?"
    if Instr(1, url, "?") > 0 then sep = "&"
    return m.server + url + sep + "t=" + m.token
end function

function idStr(v as dynamic) as string
    if v = invalid then return ""
    t = Type(v)
    if t = "roString" or t = "String" then return v
    if t = "roFloat" or t = "Float" or t = "roDouble" or t = "Double" then return Int(v).ToStr()
    return v.ToStr()
end function

function num(v as dynamic) as float
    if v = invalid then return 0
    t = Type(v)
    if t = "roString" or t = "String" then return Val(v)
    return v
end function

function color(hex as dynamic, fallback as string) as string
    if hex = invalid or Len(hex) <> 7 or Left(hex, 1) <> "#" then return fallback
    return "0x" + UCase(Mid(hex, 2)) + "FF"
end function

' ---------- screens ----------
sub show(name as string)
    m.screen = name
    m.home.visible = name = "home"
    m.library.visible = name = "library"
    m.details.visible = name = "details"
    m.profiles.visible = name = "profiles"
    m.status.visible = false
    m.spinner.visible = false
    m.logo.visible = name <> "player"
    if name = "home" then m.rows.setFocus(true)
    if name = "library" then m.grid.setFocus(true)
    if name = "details" then m.buttons.setFocus(true)
    if name = "profiles" then m.profileList.setFocus(true)
end sub

sub go(name as string)
    if m.screen <> "" and m.screen <> name then m.back.Push(m.screen)
    show(name)
end sub

sub busy(text = "" as string)
    m.home.visible = false
    m.library.visible = false
    m.details.visible = false
    m.profiles.visible = false
    m.status.text = text
    m.status.visible = text <> ""
    m.spinner.visible = true
    m.spinner.control = "start"
    m.screen = "busy"
end sub

sub problem(text as string)
    m.spinner.visible = false
    m.status.text = text + Chr(10) + Chr(10) + "Press OK to try again, or * to change the server address."
    m.status.visible = true
    m.screen = "problem"
    m.top.setFocus(true)
end sub

' ---------- server address and sign-in ----------
sub askServer()
    d = CreateObject("roSGNode", "KeyboardDialog")
    d.title = "HallFlix server address"
    d.message = "The address you open HallFlix at on your home network, for example http://192.168.1.83:8780"
    if m.server <> "" then d.text = m.server else d.text = "http://192.168.1.83:8780"
    d.buttons = ["Connect", "Cancel"]
    d.observeField("buttonSelected", "onServerDialog")
    m.top.dialog = d
end sub

sub onServerDialog(msg as object)
    d = msg.getRoSGNode()
    if msg.getData() = 0 then
        s = d.text.Trim()
        if Right(s, 1) = "/" then s = Left(s, Len(s) - 1)
        if Left(LCase(s), 4) <> "http" then s = "http://" + s
        m.server = s
        m.reg.Write("server", s)
        m.reg.Flush()
        d.close = true
        boot()
    else
        d.close = true
        if m.server = "" then m.top.exitApp = true
    end if
end sub

sub boot()
    busy("Connecting to HallFlix…")
    api("boot", "GET", "/api/boot")
end sub

sub onBoot(r as object)
    if not r.ok then
        problem("Can't reach HallFlix at " + m.server + ".")
        return
    end if
    d = r.data
    applyLook(d.look)
    if d.setup = true then
        problem("HallFlix isn't set up yet. Open it in a web browser to create the first profile.")
        return
    end if
    if d.profile <> invalid then
        m.profile = d.profile
        m.back = []
        loadHome()
    else if d.profiles <> invalid and d.profiles.Count() > 0 then
        m.profileData = d.profiles
        c = CreateObject("roSGNode", "ContentNode")
        for each p in d.profiles
            n = c.createChild("ContentNode")
            n.title = p.name
        end for
        m.profileList.content = c
        m.back = []
        show("profiles")
    else
        askName()
    end if
end sub

sub applyLook(look as dynamic)
    if look = invalid or look.theme = invalid then return
    t = look.theme
    if t.colors <> invalid then
        m.bg.color = color(t.colors.bg, "0x0A0814FF")
        m.top.findNode("dim").color = color(t.colors.bg, "0x0A0814FF")
        m.accent = color(t.colors.accent, "0x35D0D0FF")
        for each n in [m.rows, m.grid, m.seasons, m.episodes, m.profileList]
            n.focusBitmapBlendColor = m.accent
        end for
        m.top.findNode("hMeta").color = m.accent
        m.top.findNode("dMeta").color = m.accent
        m.badge.color = color(t.colors.accent2, "0xB344D6FF")
    end if
    if t.logo <> invalid and t.logo.image <> invalid and t.logo.image <> "" then m.logo.uri = img(t.logo.image) else m.logo.uri = m.server + "/assets/logo.png"
end sub

sub onProfileSelect()
    p = m.profileData[m.profileList.itemSelected]
    askPassword({ profileId: p.id }, "Password or PIN for " + p.name)
end sub

sub askName()
    d = CreateObject("roSGNode", "KeyboardDialog")
    d.title = "Your HallFlix name"
    d.buttons = ["Next"]
    d.observeField("buttonSelected", "onNameDialog")
    m.top.dialog = d
end sub

sub onNameDialog(msg as object)
    d = msg.getRoSGNode()
    name = d.text.Trim()
    d.close = true
    if name <> "" then askPassword({ name: name }, "Password or PIN for " + name)
end sub

sub askPassword(who as object, title as string)
    m.who = who
    d = CreateObject("roSGNode", "KeyboardDialog")
    d.title = title
    d.keyboard.textEditBox.secureMode = true
    d.buttons = ["Sign in", "Cancel"]
    d.observeField("buttonSelected", "onPasswordDialog")
    m.top.dialog = d
end sub

sub onPasswordDialog(msg as object)
    d = msg.getRoSGNode()
    pw = d.text
    d.close = true
    if msg.getData() <> 0 then return
    body = { password: pw }
    body.Append(m.who)
    busy("Signing in…")
    api("login", "POST", "/api/login", body)
end sub

sub onLogin(r as object)
    if not r.ok then
        show("profiles")
        d = CreateObject("roSGNode", "Dialog")
        d.title = "Couldn't sign in"
        d.message = r.error
        d.buttons = ["OK"]
        d.observeField("buttonSelected", "closeDialog")
        m.top.dialog = d
        return
    end if
    m.token = r.data.token
    m.reg.Write("token", m.token)
    m.reg.Flush()
    boot()
end sub

sub closeDialog()
    if m.top.dialog <> invalid then m.top.dialog.close = true
end sub

sub signOut()
    api("logout", "POST", "/api/logout")
    m.token = ""
    m.reg.Delete("token")
    m.reg.Flush()
    boot()
end sub

' ---------- home ----------
sub loadHome()
    busy()
    api("home", "GET", "/api/home")
end sub

function card(c as object, kind as string) as object
    n = CreateObject("roSGNode", "ContentNode")
    n.addFields({ kind: kind, itemId: idStr(c.id), accent: "", progress: 0.0, backdrop: img(c.backdrop), meta: "", play: false })
    n.title = c.title
    n.description = ""
    if c.overview <> invalid then n.description = c.overview
    meta = []
    if c.score <> invalid then meta.Push("★ " + Str(c.score).Trim())
    if c.year <> invalid then meta.Push(idStr(c.year))
    if c.rating <> invalid then meta.Push(c.rating)
    if c.genres <> invalid then
        for i = 0 to c.genres.Count() - 1
            if i < 3 then meta.Push(c.genres[i])
        end for
    end if
    if c.show <> invalid then
        n.title = c.show.title
        meta = ["S" + idStr(c.show.season) + " E" + idStr(c.show.episode) + " · " + c.title]
    end if
    n.meta = meta.Join("   ")
    if kind = "wide" then
        n.HDPosterUrl = img(c.backdrop)
        if n.HDPosterUrl = "" then n.HDPosterUrl = img(c.poster)
        n.play = true
    else
        n.HDPosterUrl = img(c.poster)
    end if
    if c.progress <> invalid and c.progress.watched <> true and num(c.progress.duration) > 0 then
        n.progress = num(c.progress.position) / num(c.progress.duration)
    end if
    return n
end function

sub onHome(r as object)
    if not r.ok then
        if r.code = 401 then
            m.token = ""
            m.reg.Delete("token")
            boot()
            return
        end if
        problem(r.error)
        return
    end if
    d = r.data
    root = CreateObject("roSGNode", "ContentNode")
    sizes = []
    heights = []
    if d.libraries <> invalid and d.libraries.Count() > 0 then
        row = root.createChild("ContentNode")
        row.title = "Libraries"
        for each l in d.libraries
            n = row.createChild("ContentNode")
            n.addFields({ kind: "library", itemId: idStr(l.id), accent: "", progress: 0.0, backdrop: img(l.backdrop), meta: "", play: false })
            n.title = l.name
            n.HDPosterUrl = img(l.backdrop)
            noun = "movies"
            if l.kind = "shows" then noun = "shows"
            sub2 = idStr(l.count) + " " + noun
            if l.fresh <> invalid and l.fresh > 0 then sub2 = sub2 + "   ·   " + idStr(l.fresh) + " new"
            n.ShortDescriptionLine2 = sub2
            n.meta = sub2
            n.description = "Open " + l.name
        end for
        sizes.Push([560, 280])
        heights.Push(360)
    end if
    for each rw in d.rows
        row = root.createChild("ContentNode")
        row.title = rw.title
        wide = rw.shape = "wide"
        for each c in rw.items
            k = "poster"
            if wide then k = "wide"
            row.appendChild(card(c, k))
        end for
        if wide then
            sizes.Push([420, 236])
            heights.Push(316)
        else
            sizes.Push([200, 300])
            heights.Push(380)
        end if
    end for
    if root.getChildCount() = 0 then
        problem("Nothing has been added yet. Add libraries in the Studio.")
        return
    end if
    m.rows.rowItemSize = sizes
    m.rows.rowHeights = heights
    m.rows.content = root
    if d.spotlight <> invalid and d.spotlight.Count() > 0 then m.backdrop.uri = img(d.spotlight[0].backdrop)
    show("home")
end sub

sub onRowFocus()
    f = m.rows.rowItemFocused
    if f = invalid or m.rows.content = invalid then return
    row = m.rows.content.getChild(f[0])
    if row = invalid then return
    n = row.getChild(f[1])
    if n = invalid then return
    m.top.findNode("hTitle").text = n.title
    m.top.findNode("hMeta").text = n.meta
    m.top.findNode("hText").text = n.description
    if n.backdrop <> "" then m.backdrop.uri = n.backdrop
end sub

sub onRowSelect()
    f = m.rows.rowItemSelected
    n = m.rows.content.getChild(f[0]).getChild(f[1])
    if n.kind = "library" then
        openLibrary(n.itemId, n.title)
    else if n.play then
        play(n.itemId, invalid, true)
    else
        openItem(n.itemId)
    end if
end sub

' ---------- a library ----------
sub openLibrary(id as string, name as string)
    m.top.findNode("lTitle").text = name
    m.back.Push(m.screen)
    busy()
    api("library", "GET", "/api/library/" + id + "?limit=200&sort=title")
end sub

sub onLibrary(r as object)
    if not r.ok then
        problem(r.error)
        return
    end if
    c = CreateObject("roSGNode", "ContentNode")
    for each it in r.data.items
        n = c.createChild("ContentNode")
        n.addFields({ itemId: idStr(it.id), backdrop: img(it.backdrop) })
        n.HDGridPosterUrl = img(it.poster)
        n.ShortDescriptionLine1 = it.title
    end for
    m.grid.content = c
    show("library")
end sub

sub onGridFocus()
    n = m.grid.content.getChild(m.grid.itemFocused)
    if n <> invalid and n.backdrop <> "" then m.backdrop.uri = n.backdrop
end sub

sub onGridSelect()
    openItem(m.grid.content.getChild(m.grid.itemSelected).itemId)
end sub

' ---------- a movie or show ----------
sub openItem(id as string)
    if m.screen <> "details" then m.back.Push(m.screen)
    busy()
    api("item", "GET", "/api/items/" + id)
end sub

sub onItem(r as object)
    if not r.ok then
        problem(r.error)
        return
    end if
    d = r.data
    m.item = d
    if d.backdrop <> invalid then m.backdrop.uri = img(d.backdrop)
    m.top.findNode("dTitle").text = d.title
    meta = []
    if d.score <> invalid then meta.Push("★ " + Str(d.score).Trim())
    if d.year <> invalid then meta.Push(idStr(d.year))
    if d.rating <> invalid then meta.Push(d.rating)
    if d.seasons <> invalid then meta.Push(idStr(d.seasons.Count()) + " seasons")
    if d.genres <> invalid then
        for i = 0 to d.genres.Count() - 1
            if i < 3 then meta.Push(d.genres[i])
        end for
    end if
    m.top.findNode("dMeta").text = meta.Join("   ")
    text = ""
    if d.overview <> invalid then text = d.overview
    m.top.findNode("dText").text = text

    prog = d.progress
    if d.kind = "show" then prog = d.playProgress
    resuming = prog <> invalid and prog.watched <> true and num(prog.position) > 20
    labels = []
    m.actions = []
    if d.playId <> invalid then
        label = "Play"
        if resuming then label = "Resume"
        if d.kind = "show" and d.playLabel <> invalid then label = label + " " + d.playLabel
        labels.Push(label)
        m.actions.Push({ id: idStr(d.playId), start: invalid })
        if resuming then
            labels.Push("From the start")
            m.actions.Push({ id: idStr(d.playId), start: 0 })
        end if
    end if
    m.buttons.buttons = labels

    isShow = d.seasons <> invalid and d.seasons.Count() > 0
    for each id in ["seasons", "seasonsLabel", "episodes", "episodesLabel"]
        m.top.findNode(id).visible = isShow
    end for
    if isShow then
        c = CreateObject("roSGNode", "ContentNode")
        for each s in d.seasons
            n = c.createChild("ContentNode")
            n.title = s.title
        end for
        m.seasons.content = c
        m.seasons.jumpToItem = 0
        fillEpisodes(0)
    end if
    show("details")
    if labels.Count() = 0 and isShow then m.episodes.setFocus(true)
end sub

sub onSeasonFocus()
    if m.item <> invalid and m.item.seasons <> invalid then fillEpisodes(m.seasons.itemFocused)
end sub

sub fillEpisodes(i as integer)
    s = m.item.seasons[i]
    if s = invalid then return
    m.seasonEpisodes = s.episodes
    c = CreateObject("roSGNode", "ContentNode")
    for each e in s.episodes
        n = c.createChild("ContentNode")
        mark = ""
        if e.progress <> invalid and e.progress.watched = true then mark = "  ✓"
        n.title = idStr(e.number) + "   " + e.title + mark
    end for
    m.episodes.content = c
end sub

sub onButton()
    a = m.actions[m.buttons.buttonSelected]
    if a <> invalid then play(a.id, a.start, true)
end sub

sub onEpisodeSelect()
    e = m.seasonEpisodes[m.episodes.itemSelected]
    if e <> invalid then play(idStr(e.id), invalid, true)
end sub

' ---------- playback ----------
sub play(id as string, start as dynamic, prerolls as boolean)
    if m.screen <> "player" and m.screen <> "busy" then m.playFrom = m.screen
    busy("Starting…")
    api("play", "POST", "/api/play", invalid, { op: "play", itemId: id, start: start, prerolls: prerolls })
end sub

sub onPlay(r as object)
    if not r.ok then
        m.video.visible = false
        m.badge.visible = false
        show(m.playFrom)
        d = CreateObject("roSGNode", "Dialog")
        d.title = "Can't play this right now"
        d.message = r.error
        d.buttons = ["OK"]
        d.observeField("buttonSelected", "closeDialog")
        m.top.dialog = d
        return
    end if
    m.queue = r.data.items
    m.mainIndex = m.queue.Count() - 1
    main = m.queue[m.mainIndex]
    m.resumeAt = 0
    if main.entry.resumeAt <> invalid then m.resumeAt = num(main.entry.resumeAt)
    m.resumed = false
    m.lastReport = 0
    c = CreateObject("roSGNode", "ContentNode")
    for each q in m.queue
        n = c.createChild("ContentNode")
        n.url = q.url
        n.streamFormat = q.format
        n.title = q.entry.title
        if q.entry.kind = "main" and q.entry.subtitle <> invalid then n.secondaryTitle = q.entry.subtitle
    end for
    m.video.content = c
    m.video.contentIsPlaylist = true
    m.video.visible = true
    m.home.visible = false
    m.library.visible = false
    m.details.visible = false
    m.status.visible = false
    m.spinner.visible = false
    m.logo.visible = false
    m.screen = "player"
    m.video.setFocus(true)
    m.video.control = "play"
    m.ping.control = "start"
    onVideoIndex()
end sub

sub onVideoIndex()
    if m.screen <> "player" then return
    i = m.video.contentIndex
    isMain = i = m.mainIndex
    m.badge.visible = m.queue[i] <> invalid and m.queue[i].entry.kind = "preroll"
    m.video.enableTrickPlay = isMain
    if isMain and not m.resumed then
        m.resumed = true
        if m.queue[i].format <> "hls" and m.resumeAt > 1 then m.video.seek = m.resumeAt
    end if
end sub

sub onVideoPosition()
    if m.screen <> "player" or m.video.contentIndex <> m.mainIndex then return
    now = m.video.position
    if Abs(now - m.lastReport) >= 10 then
        m.lastReport = now
        report(false)
    end if
end sub

sub report(ended as boolean)
    if m.queue = invalid then return
    q = m.queue[m.mainIndex]
    if q = invalid then return
    if not ended and m.video.contentIndex <> m.mainIndex then return
    dur = num(q.entry.duration)
    if dur <= 0 then dur = num(q.offset) + m.video.duration
    at = num(q.offset) + m.video.position
    if ended then at = dur
    api("progress", "POST", "/api/progress", { itemId: q.entry.itemId, position: at, duration: dur, ended: ended })
end sub

sub onVideoState()
    if m.screen <> "player" then return
    s = m.video.state
    if s = "finished" then
        report(true)
        nxt = m.queue[m.mainIndex].entry.next
        stopSessions()
        if nxt <> invalid then
            m.video.control = "stop"
            play(idStr(nxt.id), invalid, false)
        else
            closePlayer(false)
        end if
    else if s = "error" then
        msg = m.video.errorMsg
        closePlayer(true)
        d = CreateObject("roSGNode", "Dialog")
        d.title = "Playback stopped"
        d.message = msg
        d.buttons = ["OK"]
        d.observeField("buttonSelected", "closeDialog")
        m.top.dialog = d
    end if
end sub

sub onPing()
    if m.queue = invalid then return
    for each q in m.queue
        if q.sid <> invalid then api("ping", "POST", "/api/play/ping/" + q.sid)
    end for
end sub

sub stopSessions()
    m.ping.control = "stop"
    if m.queue = invalid then return
    for each q in m.queue
        if q.sid <> invalid then api("stop", "DELETE", "/api/play/session/" + q.sid)
    end for
end sub

sub closePlayer(failed as boolean)
    if not failed then report(false)
    m.video.control = "stop"
    m.video.visible = false
    m.badge.visible = false
    stopSessions()
    m.queue = invalid
    ' Come back to fresh progress and Continue Watching.
    if m.playFrom = "details" and m.item <> invalid then
        busy()
        api("item", "GET", "/api/items/" + idStr(m.item.id))
    else if m.playFrom = "library" then
        show("library")
    else
        loadHome()
    end if
end sub

' ---------- remote ----------
sub menu()
    d = CreateObject("roSGNode", "Dialog")
    d.title = "HallFlix"
    d.buttons = ["Switch profile", "Change server address", "Close"]
    d.observeField("buttonSelected", "onMenu")
    m.top.dialog = d
end sub

sub onMenu(msg as object)
    i = msg.getData()
    closeDialog()
    if i = 0 then signOut()
    if i = 1 then askServer()
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if not press then return false
    if m.screen = "player" then
        if key = "back" then
            closePlayer(false)
            return true
        end if
        return false
    end if
    if key = "options" then
        if m.screen = "problem" then askServer() else menu()
        return true
    end if
    if m.screen = "problem" and key = "OK" then
        boot()
        return true
    end if
    if m.screen = "details" then
        if key = "right" and m.buttons.hasFocus() and m.seasons.visible then
            m.seasons.setFocus(true)
            return true
        end if
        if key = "right" and m.seasons.hasFocus() then
            m.episodes.setFocus(true)
            return true
        end if
        if key = "left" and m.episodes.hasFocus() then
            m.seasons.setFocus(true)
            return true
        end if
        if key = "left" and m.seasons.hasFocus() and m.buttons.buttons.Count() > 0 then
            m.buttons.setFocus(true)
            return true
        end if
    end if
    if key = "back" then
        if m.back.Count() > 0 then
            prev = m.back.Pop()
            if prev = "home" then loadHome() else show(prev)
            return true
        end if
        return false ' leaves the channel
    end if
    return false
end function
