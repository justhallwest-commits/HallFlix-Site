' HallFlix for Roku. Screens are drawn natively; everything else comes from the HallFlix server.
sub Main(args as dynamic)
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)
    scene = screen.CreateScene("MainScene")
    screen.Show()
    scene.observeField("exitApp", port)
    while true
        msg = Wait(0, port)
        t = Type(msg)
        if t = "roSGScreenEvent" and msg.IsScreenClosed() then return
        if t = "roSGNodeEvent" and msg.GetField() = "exitApp" then return
    end while
end sub
