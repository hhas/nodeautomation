# NodeAutomation tutorial

The following tutorial provides a practical taste of application scripting with appscript. Later chapters cover the technical details of appscript usage that are mostly skimmed over here.

## 'Hello World' tutorial

This tutorial uses NodeAutomation, TextEdit and Terminal to perform a simple 'Hello World' exercise.

Caution: It is recommended that you do not have any other documents open in TextEdit during this tutorial, as accidental modifications are easy to make and changes to existing documents are not undoable.

## Start a node session

Create a new shell window in Terminal (`/Application/Utilities/Terminal.app`) and enter `node` to launch Node.js's REPL (interactive JavaScript interpreter).

To import the NodeAutomation module for use in a REPL session:

    require('nodeautomation/repl');

This imports the `app`, `con`, `its`, `k`, `File`, `CommandError` objects into the global namespace and sets the REPL's `showProxy` option to display NodeAutomation specifiers in human-readable form. Subsequent examples in this manual assume this import is used.

Alternatively, to import the NodeAutomation module into a `.js` script:

    const {app, con, its, k, File, CommandError} = require('nodeautomation');

or `.mjs` script:

	import {app, con, its, k, File, CommandError} from 'nodeautomation';


## Target TextEdit

To create a new `app` object identifying the application to be controlled, in this case macOS's `TextEdit.app`:

    const te = app('TextEdit');

The application may be identified by name, full path, bundle ID, or process ID, or, if running remotely, `eppc://` URL. If the application is local and is not already running, it will be launched automatically for you. [TBC; different method calls are required for bundle/process ID and eppc URL; in addition, remote eppc support is not yet finished]


## Create a new document

First, create a new TextEdit document by making a new `document` object. This is done using the `make` command, passing it a single keyword parameter, `new`, indicating the type of object to create; in this case `k.document`:

    te.make({ new: k.document });


Running this command produces a result similar to the following:

    app('TextEdit.app').documents.named('Untitled')


Because `document` objects are always elements of the root `application` object, applications such as TextEdit can usually infer the location at which the new document object should appear. At other times, you need to supply an `at` parameter that indicates the desired location. For example, the above `make` command can be written more fully as:

    te.make({ new: k.document, at: app.documents.end });


As you can see, the make command returns a reference identifying the newly-created object. This reference can be assigned to a variable for easy reuse. Use the make command to create another document, this time assigning its result to a variable, doc:

    let doc = te.make({ new: k.document });


## Set the document's content

The next step is to set the document's content to the string "Hello World". Every TextEdit document has a property, text, that represents the entire text of the document. This property is both readable and writeable, allowing you to retrieve and/or modify the document's textual content as unstyled unicode text.

Setting a property's value is done using the `set` command. The `set` command, like all application commands, is available as a method of the root `application` class and has two parameters: a direct (positional) parameter containing reference to the property (or properties) to be modified, and a keyword parameter, to, containing the new value. In this case, the direct parameter is a reference to the new document's text property, `doc.text`, and the `to` parameter is the string `"Hello World"`:

    te.set({ _:doc.text, to: 'Hello World' });


The front TextEdit document should now contain the text 'Hello World'.

Because the above expression is a bit unwieldy to write, NodeAutomation allows it to be written in more natural JS-style:

    doc.text.set({ to:'Hello World' });


NodeAutomation converts this second form to the first form internally, so the end result is exactly the same. NodeAutomation supports several such special cases, and these are described in the chapter on Application Commands.

## Get the document's content

Retrieving the document's text is done using the `get` command. For example:

    doc.text.get();

returns the result:

    'Hello World'


This may seem counter-intuitive if you're used to dealing with AppleScript or object-oriented JS references, where evaluating a literal reference returns the value identified by that reference. However, always remember that NodeAutomation 'references' are really object specifiers - that is, query objects. while the syntax may look familiar, any similarity is purely superficial. For example, when evaluating the following literal reference:

    te.documents[0].text;


the result is another 'reference' object, `app('/Applications/TextEdit.app').documents.named('Untitled').text`, not the value being referenced (`'Hello World'`). To get the value being referenced, you have to pass the reference as the direct parameter (`_`) to TextEdit's `get` command:

    te.get({ _:doc.text });

returns:

    'Hello World!'


For convenience, NodeAutomation allows commands to be applied directly to their direct parameter, avoiding the need to pass this parameter in the command itself:

    doc.text.get();


As a further shortcut, NodeAutomation allows the `.get` part to be omitted, and the reference called directly:

    doc.text();


These and other syntactic shortcuts are documented in the Application Commands chapter.

Depending on what sort of attribute(s) the reference identifies, `get` may return a primitive value (number, string, list, object, etc.), or it may return another object specifier, or list of object specifiers, e.g.:

    doc.text.get();
    // 'Hello World!'

    te.documents.at(1).get();
    // app('TextEdit').documents.documents.named('Untitled')

    te.documents.get();
    // [app('TextEdit').documents.documents.named('Untitled'),
    //  app('TextEdit').documents.documents.named('Untitled 2')]

    te.documents.text.get();
    // ['Hello World', '']


## More on the `make` command

The above exercise uses two commands to create a new TextEdit document containing the text 'Hello World'. It is also possible to perform both operations using the `make` command alone by passing the value for the new document's text property via the `make` command's optional `withProperties` parameter:

    te.make({ new: k.document, withProperties: {text: 'Hello World'} });
    // app('TextEdit').documents.named('Untitled')


## More on manipulating text

In addition to getting and setting a document's entire text by applying `get` and `set` commands to text property, it's also possible to manipulate selected sections of a document's text directly. TextEdit's `text` property contains a text object, which in turn has `character`, `word` and `paragraph` elements, all of which can be manipulated using a variety of commands - `get`, `set`, `make`, `move`, `delete`, etc. For example, to set the size of the first character of every paragraph of the front document to 24pt:

    te.documents.at(1).text.paragraphs.size.set({to: 24});


Or to insert a new paragraph at the end of the document:

    te.make({
          new: k.paragraph,
          withData: 'Hello Again, World\n',
          at: app.documents.at(1).text.paragraphs.end 
      });


