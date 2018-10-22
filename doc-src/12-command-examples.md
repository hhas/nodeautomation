# Command examples

## `get`

Get the name of every folder in the user's home folder:

    // tell application "Finder" to get name of every folder of home

       app('Finder').get({ _:app.home.folders.name });


Note that if the direct parameter is omitted from the parameter list, the object specifier that the command is invoked on is used instead. For example, the above example would normally be written as:

    app('Finder').home.folders.name.get();


which for convenience can be further abbreviated to this:

    app('Finder').home.folders.name();


## `set`

Set the content of a TextEdit document:

    // tell application "TextEdit" to set text of document 1 to "Hello World"

       app('TextEdit').documents.at(1).text.set({ to: 'Hello World' });


## `count`

Count the words in a TextEdit document:

    // tell application "TextEdit" to count words of document 1

       app('TextEdit').documents.at(1).words.count();


Count the items in the current user's home folder:

    // tell application "Finder" to count items of home

       app('Finder').home.count({ each: k.item });


(Be aware that applications such as Finder whose AE support is not Cocoa-based may _require_ the `each` parameter to be supplied, even though their dictionaries indicate it is optional.)

## `make`

Create a new TextEdit document:

    // tell application "TextEdit" to make new document ¬
    //      with properties {text:"Hello World\n"}

       app('TextEdit').make({ new: k.document,
          withProperties: {text: 'Hello World\n'} });


Append text to a TextEdit document:

    // tell application "TextEdit" to make ¬
    //      new paragraph ¬
    //      at end of text of document 1 ¬
    //      with data "Yesterday\nToday\nTomorrow\n"

       app('TextEdit').make({ 
            new: k.paragraph,
              at: app.documents.at(1).text.end,
              withData: 'Yesterday\nToday\nTomorrow\n' });


Note that the `make` command's `at` parameter can be omitted for convenience, in which case the object specifier that the command is called on is used instead:

    app('TextEdit').documents.at(1).text.end.make({
          new: k.paragraph, withData: 'Yesterday\nToday\nTomorrow\n' });


## `duplicate`

Duplicate a folder to a disk, replacing an existing item if one exists:

    \\ tell application "Finder" ¬
    \\      duplicate folder "Projects" of home to disk "Work" with replacing
    \\ end tell

       app('Finder').home.folders.named('Projects').duplicate({
              to: app.disks.named('Work'), replacing: true });


## `add`

Add every person with a known birthday to a group named "Birthdays":

    // tell application "Address Book" to add ¬
    //      every person whose birth date is not missing value ¬
    //      to group "Birthdays"

        app('Address Book').add({
            _: app.people.where(its.birthDate.ne(null)),
            to: app.groups.named('Birthdays') });

