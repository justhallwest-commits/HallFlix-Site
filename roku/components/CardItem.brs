sub init()
    m.bg = m.top.findNode("bg")
    m.art = m.top.findNode("art")
    m.fallback = m.top.findNode("fallback")
    m.shade = m.top.findNode("shade")
    m.edge = m.top.findNode("edge")
    m.name = m.top.findNode("name")
    m.sub = m.top.findNode("sub")
    m.bar = m.top.findNode("bar")
    m.barFill = m.top.findNode("barFill")
end sub

sub onContent()
    c = m.top.itemContent
    if c = invalid then return
    m.art.uri = c.HDPosterUrl
    m.fallback.text = c.title
    tile = c.kind = "library"
    wide = c.kind = "wide" or tile
    m.name.visible = tile
    m.sub.visible = wide
    m.shade.opacity = 0
    if tile then
        m.name.text = c.title
        m.sub.text = c.ShortDescriptionLine2
        m.shade.opacity = 0.45
    else if wide then
        m.sub.text = c.title
        m.shade.opacity = 0.25
    end if
    if c.accent <> invalid and c.accent <> "" then m.edge.color = c.accent
    m.progress = c.progress
    onSize()
end sub

sub onSize()
    w = m.top.width
    h = m.top.height
    if w = 0 or h = 0 then return
    for each n in [m.bg, m.art, m.shade]
        n.width = w
        n.height = h
    end for
    m.fallback.width = w - 20
    m.fallback.height = h
    m.fallback.translation = [10, 0]
    m.edge.width = w
    m.edge.translation = [0, h - 4]
    m.name.width = w - 48
    m.name.translation = [24, h - 110]
    m.sub.width = w - 48
    m.sub.translation = [24, h - 52]
    c = m.top.itemContent
    if c <> invalid and c.kind = "wide" then m.sub.translation = [16, h - 46]
    p = 0
    if m.progress <> invalid then p = m.progress
    m.bar.visible = p > 0
    m.barFill.visible = p > 0
    if p > 0 then
        m.bar.width = w - 24
        m.bar.translation = [12, h - 14]
        m.barFill.width = (w - 24) * p
        m.barFill.translation = [12, h - 14]
    end if
end sub

sub onFocus()
    on = m.top.rowHasFocus and m.top.focusPercent > 0.5
    m.edge.visible = on
end sub
