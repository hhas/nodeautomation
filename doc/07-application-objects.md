# Application objects


## Creating application objects

Before you can communicate with a scriptable application, you must call the app object to create an application object. For example:

    var textedit = app.named('TextEdit');


To target an application you must call one of the `app` object methods: `named`, `at`, `ID`, `currentApplication`.

### Targeting an application by name or full path

The application's file name or full POSIX path, e.g.:

    app.named('TextEdit')
    app.named('TextEdit.app')
    app.named('/Applications/TextEdit.app')

If only a file name is provided, NodeAutomation uses LaunchServices to look up the application's full path. An `.app` suffix is optional. e.g. Given the name `'TextEdit'`, NodeAutomation first searches for an application with that exact file name; if none is found, it automatically adds an `.app` suffix (`'TextEdit.app'`) and tries again.

For convenience, this can be (and normally is) shortened to `app(name)`:

    app('TextEdit');
    app('TextEdit.app'`);
    app('/Applications/TextEdit.app');


### Targeting an application by bundle ID or process ID

The application's bundle ID (String) or process ID (Number), e.g.:

    app.ID('com.apple.textedit')

    app.ID(5687)

(This method can also accept a NodObjC-wrapped `NSAppleEventDescriptor` that identifies the target application.)


### Targeting an application by remote (`eppc:`) URL

[TBC: URL support is not finished]

An `eppc://` URL identifying a remote process to be controlled via Remote Apple Events. An `eppc://` URL has the following form:

  eppc://[user[:password]@host/Application%20Name[?[uid=#]&amp;[pid=#]


For example, to target the `TextEdit` process on the Mac named `my-mac.local`, logging into that Mac as user `jsmith`:

    app.at('eppc://jsmith@my-mac.local/TextEdit')


The host name/IP address and the process name (case-sensitive) are required. 

The username and password are optional: if omitted, the OS will obtain this information from the user's keychain or display a dialog asking the user to input one or both values. (See System Preferences' Sharing panel help for configuring Remote Apple Events access on remote machines.)

The user ID (`uid`) and process ID (`pid`) are also optional. If the process ID is given, the process name will be ignored. For example, if multiple user accounts are already active on that machine, the following URL targets the TextEdit process belonging to the first logged-in user (ID 501):

    app.at('eppc://jsmith@my-mac.local/TextEdit?uid=501')


### Targeting the host process

    app.currentApplication()



## Options

[TBC: the current API needs to be revised]

All `app` object constructors also accept an additional 'options' object containing zero or more of the following properties:

* `hideOnLaunch` : `boolean` -- when launching a local application, should it be hidden? (default: `false`)

* `launchNewProcess` : `boolean` -- always launch a new instance of a local application, even if it's already running (default: `false`)

* `autoRelaunch` : `k.never`, `k.limited`, or `k.always` -- determines auto-relaunching behavior should a local application quit during use (see below) (default: `k.limited`)

* `terminology` : `k.auto`,  `k.none`,  `k.sdef`, or `Object` -- determines how terminology is retrieved (see below) (default: `k.auto`)

For example, to hide iTunes on launch and allow this `app` object to relaunch it as necessary when sending any command at any time:

    var itunes = app('iTunes', {hideOnLaunch: true, autoRelaunch: k.always})


### More examples

    var cal = app('Calendar');

    var textedit = app('TextEdit.app');

    var safari = app('/Applications/Safari');

    var addressbook = app.ID('com.apple.addressbook');

    finder = app.at('eppc://192.168.10.1/Finder');

    itunes = app.at('eppc://Jan%20Smith@media-mac.local/iTunes');


## Basic commands

All applications should respond to the following commands:


* `run()` -- Run an application. Most applications will open an empty, untitled window.
* `launch()` -- Launch an application without sending it a `run` event. Applications that normally open a new, empty document upon launch won't do so.
* `activate()` -- Bring the application to the front.
* `reopen()` -- Reactivate a running application. Some applications will open a new untitled window if no window is open.
* `open(value)` -- Open the specified object(s). The value is list of objects to open, typically a list of `Path` objects.
* `print(value)` -- Print the specified object(s). The value is a list of objects to print, typically a list of `Path` objects.
* `quit({saving: value})` -- Quit an application. The `saving` value is one of the following: `k.yes`, `k.ask`, or `k.no`, indicating whether or not any currently open documents should be saved before quitting.


Note that NodeAutomation will automatically run an application in order to get its terminology. To start an application with a `launch` event instead of the usual `run` event, the launch command must be used immediately after an application object is created (i.e. before constructing any object specifiers or sending other commands).

Some applications may provide their own definitions of some or all of these commands, so check their terminology before use.

NodeAutomation also defines `get` and `set` commands for any scriptable application that doesn't supply its own definitions:

    get({ _:specifier }) -- Get the data for an object.
        specifier -- the object for the command
        Result: anything -- the reply for the command

    set({ _:specifier, to: value }) -- Set an object's data.
        specifier -- the object for the command
        to : anything -- The new value.


Note that these commands are only useful when targetting applications that define an Apple Event Object Model as part of their Apple event interface, or when targetting stay-open script applications created by Script Editor.


## Transaction support

[TO DO: transaction methods aren't yet implemented, and it's unclear if it's worth doing so since [almost?] no scriptable applications supprt them any more.]


## Local application launching notes

Note: the following information only applies to local applications as NodeAutomation cannot directly launch applications on a remote Mac. To control a remote application, the application must be running beforehand or else launched indirectly (e.g. by using the remote Mac's Finder to open it).


### How applications are identified

When you create an app object by application name or bundle ID, NodeAutomation uses LaunchServices to locate an application matching that description. If you have more than one copy of the same application installed, you can identify the one you want by providing its full path, otherwise LaunchServices will identify the newest copy for you.


### Checking if an application is running

You can check if the application specified by an Application object is currently running by getting its `isRunning` property. This is useful if you don't want to perform commands on an application that isn't already running. For example:

    var te = app('TextEdit');
    // Only perform TextEdit-related commands if it's already running:
    if (te.isRunning) {
      // all TextEdit-related code goes here...
    }


Remember that NodeAutomation automatically launches a non-running application the first time your script refers to any of its properties, elements or commands. To avoid accidental launches, all code relating to that application must be included in a conditional block that only executes if `isRunning` returns `true`.


### Launch errors

[TO DO: error reporting is not yet finalized]

If the application can't be launched for some reason (e.g. if it's in the Trash), a "can't launch application" error will be raised. This provides a description of the problem (if it's a standard LaunchServices error) along with the original OS error number.


### Using `launch` vs `run`

[TBC: `launch` command is not yet implemented]

When NodeAutomation launches a non-running application, it normally sends it a `run` command as part of the launching process. If you wish to avoid this, you should start the application by sending it a `launch` command before doing anything else. For example:

    var te = app('TextEdit');
    te.launch();
    // other TextEdit-related code goes here...


This is useful when you want to start an application without it going through its normal startup procedure. For example, the above script will launch TextEdit without causing it to display a new, empty document (its usual behaviour).

`launch` is also useful if you need to send a non-running application an `open` command as its very first instruction. For example, to send an open command to a non-stay-open application that batch processes one or more dropped files then quits again, you must first start it using `launch`, then send it an `open` command with the files to process. If you forget to do this, the application will first receive a `run` command and quit again before the `open` command can be handled.


### Auto-relaunching

As soon as you start to construct an object specifier or command using a newly created Application object, if the application is not already running then NodeAutomation will automatically launch it in order to obtain its terminology.

If the target application has stopped running since the app object was created, trying to send it a command using that app object will normally result in an invalid connection error (-609), unless that command is `run` or `launch`. This restriction prevents NodeAutomation accidentally restarting an application that has unexpectedly quit while a script is controlling it. Scripts can restart the application by sending an explicit `run` or `launch` command, or by creating a new `app` object for it.

An `app` object's auto-relaunching behaviour can be modified by supplying an options object containing an `autoRelaunch` property with one of the following keyword values:


* `k.never` - Sending any command to a previously quit application will produce an 'invalid connection' error.
* `k.limited` - A previously quit application will be automatically relaunched when a run or launch command is sent; other commands will produce an 'invalid connection' error. This is the default behaviour.
* `k.always` - A previously quit application will be automatically relaunched when any command is sent. This is the same behaviour as AppleScript.


For example:

    var itunes = app('iTunes', {autoRelaunch: k.always});
    // rest of code goes here...


Note that you can use app objects to control applications that have been quit and restarted since the app object was created. NodeAutomation will automatically update the app object's process serial number information as needed, as long as the application is running at the time.

    

### Terminology options

[TBC: not yet implemented]

The `terminology` option accepts one of the following three keywords that determine how an application's terminology should be retrieved':


    * `k.auto` -- terminology is automatically retrieved from application in AETE format; this is the default
    * `k.none` -- terminology is not retrieved from the application; only built-in core terms (`run`, `open`, `quit`, etc.) are available
    * `k.sdef` -- terminology is automatically retrieved from application in SDEF format


Some applications have buggy "get dynamic terminology" (`ascrgdte`) handlers which prevent the `k.auto` option retrieving the correct terminology. The `k.sdef` option can be used to work around this bug by retrieving the terminology in SDEF format instead, for example:

    app('Finder', {terminology: k.sdef}).home()

When using this option, be aware that some terminology may still be missing due to bugs in OS X's automatic AETE-to-SDEF conversion.


If an application's own terminology is too defective or unretrievable to be used as-is, the `terminology` option can also accept a static terminology glue. This is a JavaScript object containing five properties - `types`, `enumerators`, `properties`, `elements`, and `commands` - that contain the raw name-code mappings for the application's terminology.


