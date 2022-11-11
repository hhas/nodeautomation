# Performance issues


Application scripting is subject to a number of potential performance bottlenecks:

* Sending Apple events is more expensive than calling local functions.
* There may be significant overheads in how applications resolve individual object specifiers.
* Packing and unpacking large and/or complex values (e.g. a long list of object specifiers) can take an appreciable amount of time.

Fortunately, it's often possible to minimise performance overheads by using fewer commands to do more work. Let's consider a typical example: obtaining the name of every person in Address Book.app who has a particular email address. There are several possible solutions to this, each with very different performance characteristics:

## The iterative OO-style approach

While iterating over application objects and manipulating each in turn is a common technique, it's also the slowest by far:

    let desiredEmail = 'sjones@example.com';
    let foundNames = [];

    for ( let person of app('Address Book').people.get() ) {
      for ( let email of person.emails.get() ) {
        if ( email.value.get() == desiredEmail ) {
          foundNames.push( person.name.get() );
        }
      }
    }
    console.log(foundNames);
    // ['Sam Jones']


The above script sends one Apple event to get a list of object specifiers to all people, then one Apple event for each person to get a list of object specifiers to their emails, then one Apple event for each of those emails. Thus the time taken increases directly in proportion to the number of people in Address Book. If there's hundreds of people to search, that's hundreds of Apple events to be built, sent and individually resolved, and performance suffers as a result.

The solution, where possible, is to use fewer, more sophisticated commands to do the same job.


## The smart query-oriented approach

While there are some situations where iterating over and manipulating each application object individually is the only option (for example, when setting a property in each object to a different value), in this case there is plenty of room for improvement. Depending on how well an application implements its AEOM support, it's possible to construct queries that identify more than one application object at a time, allowing a single command to manipulate multiple objects in a single operation.

In this case, the entire search can be performed using a single complex query sent to Address Book via a single Apple event:

    let desiredEmail = 'sjones@example.com';

    let result = app('Address Book').people.where(
            its.emails.value.contains(desiredEmail)).name.get();
        
    console.log(result);
    // ['Sam Jones']


To explain:


* The query states: find the name of every person object that passes a specific test.
* The test is: does a given value, 'sjones@example.com', appear in a list that consists of the value of each email object contained by an individual person?
* The command is: evaluate that query against the AEOM and get (return) the result, which is a list of zero or more strings: the names of the people matched by the query.


## The hybrid solution

While AEOM queries can be surprisingly powerful, there are still many requests too complex for the application to evaluate entirely by itself. For example, let's say that you want to obtain the name of every person who has an email addresses that uses a particular domain name. Unfortunately, this test is too complex to express as a single AEOM query; however, it can still be solved reasonably efficiently by obtaining all the data from the application up-front and processing it locally. For this we need: 1. the name of every person in the Address Book, and 2. each person's email addresses. Fortunately, each of these can be expressed in a single query, allowing all this data to be retrieved using just two `get` commands.

    let desiredDomain = '@example.net';

    // get a list of names
    let names = app('Address Book').people.name.get();
    // ['Sam Jones', 'Kay Smith', ...]

    // get a list of lists of emails
    let emails = app('Address Book').people.emails.value.get();
    // [['sam@example.org', 'sjones@example.com'], ['ksmith@example.net'], ...]

    let foundNames = [];
    for ( let i = 0; i &lt; names.length; i++ ) {
      for ( let email of emails[i] ) {
        if ( email.endsWith(desiredDomain) ) {
          result.push( names[i] );
          break;
        }
      }
    }
    console.log(result);
    // ['Kay Smith', ...]


This solution isn't as fast as the pure-query approach, but is still far more efficient than iterating over and manipulating each of the application objects themselves.

