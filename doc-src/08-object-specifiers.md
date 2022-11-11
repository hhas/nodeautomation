# Object specifiers

## Property specifiers

An object property contains one of the following:

* a simple value (number, string, array, etc.) that describes an attribute of that object, such as its name, class, size, or, color.
* an object specifier that represents a one-to-one relationship between this object and another object within the application's object model, providing a convenient shortcut to another object of particular interest to users; for example, the Finder's `startupDisk and` `home` properties identify the current user's startup disk and home folder, iTunes' `currentTrack` property contains a object specifier that identifies the currently playing track.

Syntax:

    objectSpecifier.property


Examples:

    textedit.name
    textedit.documents.at(1).text
    finder.home.files.name


## Element specifiers

Many objects also have elements, which represent a one-to-many relationship between that object and others. 

Object elements often mirror the application's underlying hierarchical data model; for example, the Finder's `application` object contains one or more `disk` objects, which can contain any number of `file` and/or `folder` objects, which may contain further `file` and/or `folder` objects, and so on, just as the file system itself is structured:

    app('Finder').disks.folders...files


At other times, they may represent relationships provided simply as a convenience to scripters, e.g. the Finder's `application` object also provides `file` and `folder` elements as quick shortcuts to `file` and `folder` objects on the user's desktop; thus all these object specifiers identify the same file objects (assuming the current user is named `jsmith`):

    app('Finder').startupDisk.folders.named('Users').folders.named('jsmith').folders.named('Desktop').files

    app('Finder').home.folders.named('Desktop').files

    app('Finder').desktop.files

    app('Finder').files


A element specifier uses the following syntax to identify _all_ of an object's elements by default:

    objectSpecifier.elements


Examples:

    finder.home.folders
    textedit.windows
    textedit.documents.paragraphs


**Important:** Applications normally name their property in the singular (e.g. `size`, `currentTrack`), while providing both both singular _and_ plural versions of element names (e.g. `disk`/`disks`, `fileTrack`/`fileTracks`). AppleScript allows element names to be written either in the singular or the plural, and automatically corrects any sloppy grammar when the script is compiled. In NodeAutomation, element names are _always_ written in the plural form (e.g. `disks`, `fileTracks`), except where an application dictionary forgets to provide plural name forms, in which case it falls back to the singular form. [TBC]


## Targeted vs untargeted specifiers

While most object specifiers are built using an `app` object that is targeted at a specific application, NodeAutomation also allows you to construct untargeted specifiers that do not refer to a specific application. 

A targeted object specifier begins with an `app` object that identifies the application whose object(s) it refers to, e.g.:

    app('TextEdit').documents.end;

    app.atURL('eppc://my-mac.local/Finder').home.folders.name;


An untargeted specifier begins with `app`, `con` or `its` without indicating the application to which it should eventually be sent, e.g.:

    app.documents.end

    con.words.at(3)

    its.name.beginsWith('d')


Untargeted specifiers provide a convenient shortcut when writing object specifiers that are only used in another object specifier's reference form methods:

    app('Finder').home.folders.where(its.name.beginsWith('d')).get();

    app('Tex-Edit Plus').windows.at(1).text.range(con.words.at(2), 
                                                  con.words.at(-2)).get();


or as command parameters:

    app('TextEdit').make({ new: k.word,
                           at: app.documents[1].words.end, 
                           withData: 'Hello' });

    app('Finder').desktop.duplicate({ 
                  to: app.home.folders.named('Desktop Copy') });


## Other features

To determine if a variable contains a specifier object:
    
    let someVariable = app('Finder').desktop.files;
    app.isSpecifier(someVariable);
    //--> true


