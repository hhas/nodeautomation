# Application commands

[TO DO: need general intro to/review of commands and what they do]

[TO DO: need section (chapter?) on getting/setting user-defined properties and calling user-defined subroutines in stay-open applets, which are identified by prefixing their names with `$`, e.g. `tell app "MyApplet" to foo_bar(1, 2, 3)` -> `app("MyApplet").$foo_bar([1, 2, 3])`]


## Command syntax

A command accepts a single (optional) arguments object containing the command's direct parameter (`_`) and/or named parameters, plus standard event attributes (`sendOptions`, `withTimeout`, `ignoring`). For example, to set the text of the frontmost TextEdit document:
    
    app('TextEdit').set({ _: app.documents.first.text, to: "Hello, World!" });

(The arguments object is required as JavaScript does not support true keyword parameters. The underscore key, `_`, indicates the direct parameter.)

If the direct parameter is an object specifier, the same command can be written more concisely like this:

    app('TextEdit').documents.first.text.set({ to: "Hello, World!" });

When a command is called on an object specifier, NodeAutomation automatically uses that 'parent' specifier as the command's direct parameter if it does not already have one. (One exception to this rule: the `make` command packs the parent specifier as its `at` parameter instead.) This makes code easier to read so is the preferred syntax.

The following `close` command closes all TextEdit documents, asking the user what to do about any unsaved changes:

    app('TextEdit').documents.close({ saving: k.ask });

 By default, macOS waits 2 minutes for the application to reply before reporting a timeout error, but this can be shortened or extended if needed. The following command reports a timeout error if the application hasn't responded after 30 seconds:

    app('TextEdit').documents.close({ saving: k.ask, withTimeout: 30 });

The following `quit` command uses neither a direct parameter nor any named parameters or attributes, so the arguments object can be omitted entirely:

    app('TextEdit').quit();

When passing a direct parameter, always remember to wrap it in an arguments object, using an underscore `_` as its key:

    app('iTunes').subscribe({ _:'http://www.example.com/feeds/podcast' });

    app('TextEdit').open({ _:File('/Users/jsmith/ReadMe.txt') });


## Examples

    // tell application "TextEdit" to activate
       app('TextEdit').activate();

    // tell application "TextEdit" to open pathsList
       app('TextEdit').open({ _:pathsList });

    // tell application "Finder" to get version
       app('Finder').get({ _:app.version });
       app('Finder').version.get(); // preferred syntax

    // tell application "Finder" to set name of file "foo.txt" of home to "bar.txt"
       app('Finder').home.files.named('foo.txt').name.set({ to: 'bar.txt' })

    // tell application "TextEdit" to count (text of first document) each paragraph
       app('TextEdit').documents.first.text.count({ each: k.paragraph })

    // tell application "TextEdit" to make new document at end of documents
       app('TextEdit').make({ new: k.document, at: app.documents.end });
       app('TextEdit').documents.end.make({ new: k.document }); // preferred syntax

    // tell application "Finder" to get items of home as alias list
       app('Finder').home.items.get({ asType: k.alias });


## Command attributes

Whereas an Apple event's parameters contain user data to be passed directly to the application's event handler for processing, its attributes control exactly _how_ the Apple event should be sent and received. While the default values are sufficient in most cases, you can supply alternate values via the command's parameters object if required. The following attribute names are recognized:

* `ignoring` - a list of zero or more of the following keywords - `k.case`, `k.diacriticals`, `k.hyphens`, `k.punctuation`, `k.whitespace`, `k.numericStrings` - indicating which text attributes the application should consider or ignore when comparing text values itself. The default is `[k.case]`, i.e. ignore case but consider all other attributes. (Note that most applications ignore text comparison flags and always use the default.)

* `asType` - A keyword indicating the type of value the command should return as its result (assuming it knows how to produce values of that type). This attribute is supported by some application's `get` commands; for example, for example, to tell Finder to return an alias value (`Path`) instead of a file/folder object specifier, use `get({ asType: k.alias })`.

* `timeout` - The number of seconds NodeAutomation should wait for the application to respond before giving up and reporting a timeout error. To wait forever, use `0`. To use the default timeout (2 minutes), use `null`. [TBC]

* `sendOptions` - [TBC]


## Syntactic special cases

The following syntactic shortcuts are implemented for convenience:

## `get` command

Calling an object specifier directly is equivalent to calling its `get` command, i.e.:

    objectSpecifier()

is shorthand for:

    objectSpecifier.get()

Thus the following commands are all functionally identical:

    app('Finder').get({ _:app.version} );

    app('Finder').version.get();

    app('Finder').version();


## `make` command

If a `make` command does not already have an `at` parameter then NodeAutomation will use the object specifier upon which it was called instead; thus:

    insertionSpecifier.make({ new: className })

is shorthand for:

    applicationObject.make({ new: className, at: insertionSpecifier })

For example:

    app('TextEdit').make({ new: k.document, at: app.documents.end });

is written more neatly as:

    app('TextEdit').documents.end.make({ new: k.document });


## `count` command

The `count` command doesn't exactly replicate AS's own behavior. Unlike AS, NodeAutomation doesn't restructure the direct parameter and add an `each` parameter itself. This is not an issue with Cocoa apps, but some Carbon apps - e.g. Illustrator - _require_ an `each` parameter to be given even though their dictionaries may imply this parameter is optional, and will return a 'missing parameter' error -1701 if the user doesn't supply the `each` parameter herself.



## Command errors

[TO DO: need to update this section once error reporting is finished]

The CommandError exception describes an error raised by the target application or Apple Event Manager when sending a command.

    CommandError(Exception)

        Properties:
          errorNumber : int -- Mac OS error number
          errorMessage : str -- application-supplied/generic error description
          offendingObject : anything | None -- object that caused the error, 
                                               if given by application
          expectedType : anything | None -- object that caused a coercion error, 
                                            if given by application
          partialResult : anything | None -- part of return value constructed 
                                             before error occurred, if given 
                                             by application

      Methods:

          toNumber() -- Mac OS error number

          toString() -- formatted description of error


## Note to AppleScript users

[TO DO: need to decide what to do with this section; update, move to an earlier point in the chapter/manual; delete as redundant]

Unlike AppleScript, which implicitly sends a `get` command to any unresolved object specifiers at the end of evaluating an expression, NodeAutomation only resolves a specifier when it receives an appropriate command. For example:

    d = app('TextEdit').documents

is not the same as:

    set d to documents of app "TextEdit"

even though the two may look similar. In the first case, the value assigned to `d` is an object specifier: `app('TextEdit').documents`. In the second, AppleScript evaluates the documents of `app "TextEdit"` reference by performing an implicit `get` command and then assigning its result, a list of references to individual documents, to d. To obtain the original reference as an AppleScript value, the literal reference must be preceded by an a reference to operator as shown below.

To get a single reference to all documents:

    set d to a reference to documents of app "TextEdit"
    return d
    --> a reference to documents of app "TextEdit"

    var d = app('TextEdit').documents;
    console.log(d);
    //--> app('TextEdit').documents

To get a list of references to each document:

    set d to get documents of app "TextEdit" -- (explicit 'get' is optional)
    return d
    --> {document 1 of app "TextEdit", document 2 of app "TextEdit"}

    var d = app('TextEdit').documents.get(); // (explicit 'get' is required)
    console.log(d);
    //-->  [app('TextEdit').documents.at(1), app('TextEdit').documents.at(2)]


