sub init()
    m.top.functionName = "execute"
end sub

sub execute()
    r = m.top.request
    if r.op = "play" then
        m.top.response = playQueue(r)
    else
        m.top.response = http(r.server, r.token, r.method, r.path, r.body)
    end if
end sub

' One HTTP call. Returns { ok, code, data, error }.
function http(server as string, token as dynamic, method as dynamic, path as string, body as dynamic) as object
    if method = invalid then method = "GET"
    port = CreateObject("roMessagePort")
    x = CreateObject("roUrlTransfer")
    x.SetMessagePort(port)
    x.SetUrl(server + path)
    x.SetCertificatesFile("common:/certs/ca-bundle.crt")
    x.InitClientCertificates()
    x.RetainBodyOnError(true)
    x.AddHeader("Accept", "application/json")
    if token <> invalid and token <> "" then x.AddHeader("Authorization", "Bearer " + token)
    x.SetRequest(method)
    started = false
    if method = "GET" then
        started = x.AsyncGetToString()
    else
        x.AddHeader("Content-Type", "application/json")
        payload = "{}"
        if body <> invalid then payload = FormatJson(body)
        started = x.AsyncPostFromString(payload)
    end if
    if not started then return { ok: false, code: 0, error: "Could not reach the server" }
    msg = Wait(30000, port)
    if Type(msg) <> "roUrlEvent" then
        x.AsyncCancel()
        return { ok: false, code: 0, error: "The server took too long to answer" }
    end if
    code = msg.GetResponseCode()
    text = msg.GetString()
    data = invalid
    if text <> invalid and text <> "" then data = ParseJson(text)
    if code >= 200 and code < 300 then return { ok: true, code: code, data: data }
    err = "Could not reach the server"
    if code > 0 then err = "The server answered " + code.ToStr()
    if data <> invalid and data.error <> invalid then err = data.error
    return { ok: false, code: code, data: data, error: err }
end function

' What this Roku plays without help, in the server's terms (see decide() in playback.js).
function caps() as object
    di = CreateObject("roDeviceInfo")
    video = ["h264"]
    video10 = []
    hevc = di.CanDecodeVideo({ Codec: "hevc" }).Result = true
    if hevc then
        video.Push("hevc")
        if di.CanDecodeVideo({ Codec: "hevc", Profile: "main 10" }).Result = true then video10.Push("hevc")
    end if
    if di.CanDecodeVideo({ Codec: "vp9" }).Result = true then video.Push("vp9")
    if di.CanDecodeVideo({ Codec: "av1" }).Result = true then video.Push("av1")
    if di.CanDecodeVideo({ Codec: "mpeg2" }).Result = true then video.Push("mpeg2video")
    audio = ["aac", "mp3"]
    for each a in ["ac3", "eac3", "flac", "opus", "dts"]
        if di.CanDecodeAudio({ Codec: a }).Result = true then audio.Push(a)
    end for
    return { containers: ["mp4", "mov", "mkv"], video: video, video10: video10, audio: audio, hlsHevc: hevc, audioSwitch: true, maxHeight: 0 }
end function

' Ask what to play (pre-rolls, then the title) and give each entry an address the Video node can open.
function playQueue(r as object) as object
    c = caps()
    body = { itemId: r.itemId, caps: c, prerolls: r.prerolls <> false }
    if r.start <> invalid then body.start = r.start
    res = http(r.server, r.token, "POST", "/api/play", body)
    if not res.ok then return res
    out = []
    for each e in res.data.queue
        at = 0
        if e.kind = "main" and e.resumeAt <> invalid then at = e.resumeAt
        if e.mode = "direct" then
            url = e.url
            if url = invalid then url = "/api/file/" + toStr(e.itemId)
            out.Push({ entry: e, url: r.server + url + "?t=" + r.token, format: fmtFor(e), offset: 0, sid: invalid })
        else
            s = http(r.server, r.token, "POST", "/api/play/session", { itemId: e.itemId, start: at, caps: c })
            if s.ok then
                if s.data.direct = true then
                    out.Push({ entry: e, url: r.server + s.data.url + "?t=" + r.token, format: fmtFor(e), offset: 0, sid: invalid })
                else
                    out.Push({ entry: e, url: r.server + s.data.url, format: "hls", offset: s.data.start, sid: s.data.sid })
                end if
            else if e.kind = "main" then
                return s
            end if
        end if
    end for
    return { ok: true, code: 200, data: { items: out } }
end function

' The Video node's name for the file's container.
function fmtFor(e as object) as string
    if e.container = invalid then return "mp4"
    if e.container = "mkv" or e.container = "webm" then return "mkv"
    return "mp4"
end function

function toStr(v as dynamic) as string
    if v = invalid then return ""
    t = Type(v)
    if t = "roString" or t = "String" then return v
    if t = "roInteger" or t = "Integer" or t = "roLongInteger" or t = "LongInteger" then return v.ToStr()
    if t = "roFloat" or t = "Float" or t = "roDouble" or t = "Double" then return Int(v).ToStr()
    return ""
end function
