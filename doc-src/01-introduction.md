# Introduction

[Note: this is a quick-and-dirty adaptation of appscript documentation, which is what NodeAutomation's design is based on. The content and presentation is less than ideal, but it'll have to do for now.]

The NodeAutomation bridge allows 'AppleScriptable' applications to be controlled by Node.js (JavaScript) scripts.

For example, to get the value of the first paragraph of the topmost document in TextEdit:

    app('TextEdit').documents.at(1).paragraphs.at(1).get()

This is equivalent to the AppleScript statement:

    tell application "TextEdit" to get paragraph 1 of document 1


Or to create a new "Hello World!" document in TextEdit:

    app('TextEdit').make({new: k.document, 
                          withProperties: {text: "Hello World!"}})

which is equivalent to this:

    tell app "TextEdit" to make new document ¬
                              with properties {text: "Hello World!"}


## Before you start...

In order to use NodeAutomation effectively, you will need to understand the differences between the Apple event and JavaScript object systems.

In contrast to the familiar object-oriented approach of other inter-process communication systems such as COM and Distributed Objects, Apple event IPC is based on a combination of remote procedure calls and first-class queries - somewhat analogous to using XPath over XML-RPC. (TO DO: can any helpful comparisons to jQuery's selector support be made, or will this confuse/mislead more than it helps?)

While NodeAutomation borrows from JS's own OO syntax for conciseness and readability, like AppleScript, it behaves according to Apple event rules. Apple event queries are much more powerful and expressive than JS's OO references, so cannot be adequately described using only standard OO syntax and idioms. As a result, JS users will discover that some things work differently in NodeAutomation from what they're used to. For example:

[ TO DO: brief examples of each; maybe split these bullet points into separate subheadings ]

* Object elements are one-indexed, not zero-indexed as in JS arrays, and while NodeAutomation does recognize JS's own zero-indexed `ref[...]` and `ref.slice(...)` notations as a convenience, most 'references' can only be constructed by using NodeAutomation's own 'reference form' methods: `at`, `named`, `thru`, `where`, etc.

* Evaluating a 'reference' to a property of an application object, e.g. `app('TextEdit').documents.at(1).name` does not automatically return the property's value. It merely returns an object specifier (query) that describes the location of that property (`app('TextEdit').documents.at(1).name`). To retrieve that property's value, the object specifier must be sent to the application in a `get` command, e.g. `app('TextEdit').documents.at(1).name.get() → 'Untitled.txt'`.

* Apple events use keyword parameters, which JS does not natively support, so any parameters must be wrapped in a single JS object before being passed to an application command in NodeAutomation.

* Many applications allow a single command to operate on multiple objects at the same time, providing significant performance benefits when manipulating large numbers of application objects.


Chapters 2 and 3 of this manual provide further information on how Apple event IPC works and a tutorial-based introduction to NodeAutomation. Chapter 4 describes various ways of getting help when scripting applications. Chapters 5 through 12 cover the NodeAutomation interface, and chapter 13 discusses techniques for optimizing performance.


## Installing NodeAutomation

    npm install nodeautomation


(Requires NodObjC, which requires Xcode to install.)
