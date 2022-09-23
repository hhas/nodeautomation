# README

NodeAutomation is a Node.js module that allows 'AppleScriptable' applications 
to be controlled directly from JavaScript.

For example, to get the value of the first paragraph of the document named
'README' in TextEdit:

    app('TextEdit').documents.named('README').paragraphs[0].get()

This is equivalent to the AppleScript statement:

    tell application "TextEdit" to get paragraph 1 of document "README"


Or to create a new "Hello World!" document in TextEdit:

    app('TextEdit').make({new: k.document, 
                          withProperties: {text: "Hello World!"}})

Documentation is included in the NodeAutomation package.

______________________________________________________________________________

Dependencies:

- objc -- https://github.com/hhas/objc (development fork)
- libxmljs2
- ffi-napi
- ref-napi

______________________________________________________________________________

Caution: This is an alpha release. There will be bugs and rough edges.

E&OE. No warranty given. Use at own risk. Etc.

(See also: http://appscript.sourceforge.net/status.html)


______________________________________________________________________________

Test:

    $ node
    > const {app} = require('nodeautomation')
    > const finder = app('Finder')
    > finder.home()
    app('Finder').startupDisk.folders.named('Users').folders.named('jsmith')

______________________________________________________________________________

Known issues:

`util.inspect.custom` needs work (`Proxy` wrappers currently appear in REPL)

Relies on several now-deprecated CoreServices/Cocoa functions/methods for
which macOS does not provide replacements.
