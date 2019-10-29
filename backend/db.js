// Custom database for the HitchHike backend

/* overview of structures

* Users stored in hashmap with the key being their username

* Users written to backup file upon signup

* Rides store in two data structues:
    * R-tree stores rideID according to 2D location
    * rideID stored in hashmap where departure time is the key

*/

var security = require("./security.js");
const fs = require('fs'); 
var HashMap = require('hashmap');
var Heap = require('heap');
var RBush = require('rbush');
var knn = require('rbush-knn');

// storing users in hashmap where key is unique email
var __users = new HashMap()

// store ride objects in R tree for spacial lookup
var __rides = new RBush();

// store departureTime: rideID
var rideQueue = new HashMap()

// user object that will be stored in ram
function User(fName, lName, username, password, email, DOB){
    this.username = username;
    this.password = security.encryptPasword(password)
    this.fName = fName;
    this.lName = lName;
    this.email = email;
    this.DOB = DOB;
    this.postedRides = [];
    
    //new users start unvarified
    this.userStatus = {
        verified: false    
    }

    __users.set(username, this)
}

// ride object
function Ride(username, origin, destination, seats, dateString){
    this.rideID = RideID(username, dateString);
    this.origin = origin;
    this.destination = destination;
    this.maxSeats = seats;
    this.departTime = dateString

    return this
}

// create unique rideID
function RideID(username, date){
    departure = (date.getDay() + ":" + date.getHours() + ":" + date.getMinutes())
    return (username + ":" + departure)
}

// remove rides who's departure time has passed
function updateRides(){
    var date = new Date()

    //console.log("updating rides")
    key = (date.getDay() + ":" + date.getHours() + ":" + date.getMinutes())

    if (rideQueue.has(key)){

        val = rideQueue.get(key)
        rideQueue.delete(key)
        __rides.remove(val.ref)

        // add ride to pastRides JSON file
        // Do we delete ride from user's posted ride feild?

        console.log("ride with ID=", rideID, "has expired, moving it to pastRides")
    }
}

// make updateRides run every 30 seconds 
let timerId = setInterval(() => updateRides(), 30000);

// find user in __users
function findUser(username){
    try{ return __users.get(username)}
    catch(e){
        console.log(e)
        return e
    }
}

// every time a new user signs up, write to file
function write_to_file(user_obj){
    json_obj = JSON.stringify(user_obj)

    fs.readFile('backup.json', 'utf-8', function(err, data) {
        if (err) throw err

        var backup = JSON.parse(data)
        backup.users.push(user_obj)

        fs.writeFile("backup.json", JSON.stringify(backup), function(err){
            if (err) throw err;
        });

        //console.log(backup)
    })
}

// read users from file
function readBackup(username, status){
    console.log("usage: Reading __users from disk")
    
    var text = fs.readFileSync('backup.json')
    var file = JSON.parse(text)

    for (var i=0; i<file['users'].length; i++){
        
        // seach for single user
        if (status >= 0){ 
            if (file['users'][i]['username'] == username){
                console.log("found user")
                return file['users'][i]
            }
        }
        // transfer entire backup file to __users array
        else{
            __users.set(username, file['users'][i])
            return
        }
    }
}

// public functions availiable to index.js
module.exports = {

    newUser: function(fName, lName, username, password, email, DOB){
        console.log("creating new user")

        if (__users.has(username)){
            throw Error ('username in use')
        }

        var user = new User(fName, lName, username, password, email, DOB)

        // writing user to backup immediately for now
        console.log(user)
        write_to_file(user)

        return user
    },

    getUser: function(username){
        
        // if db crashed, read from file
        if (__users.size == 0){
            readBackup(username, -1)
            user = findUser(username)
            console.log(user)
            return user
        }
        else{
            user = findUser(username)
            //console.log(user)
            return user
        }
    },

    updateUser: function(username, field, oldP, newP){
        console.log("updating user")
        try{
            user = module.exports.getUser(username)
            if (field == "password"){
                security.updatePassword(username, oldP, newP)
            }
            user[field] = newP
            __users.set(username, user)
        }
        catch(e){
            console.log("was not able to update user", username, e)
        }
    },

    deleteUser: function(username){
        console.log("removing user from database")

        if (__users.has(username)){
            __users.delete(username)
            console.log("user deleted successfuly")
        }
        else{
            console.log("could not delete user because email was not found")
        }
    },

    // date is in format: "August 19, 1975 23:15:30"
    postRide: function(username, origin, destination, seats, dateString){
        
        user = module.exports.getUser(username)

        /*if (user.userStatus.verified === false){
            throw Error ("must be verified to post a ride")
        }*/

        date = new Date(dateString)

        // store by day, hour, minutes
        departure = (date.getDay() + ":" + date.getHours() + ":" + date.getMinutes())

        // create the ride
        var ride = new Ride(username, origin, destination, seats, date)

        const node = {
            minX: origin.x,
            minY: origin.y,
            maxX: origin.x,
            maxY: origin.y,
            Ride: ride
        }

        // add ride node to R tree for efficient searching
        __rides.insert(node);

        // add ride node to user's ride field so thet can view and update
        user.postedRides.push(node)

        // add ride node to ride queue so we can dynamically update once they are completed
        rideQueue.set(departure, node)
    },

    deleteRide: function(username){
        try{
            user = module.exports.getUser(username)
            rideNode = user.postedRides[user.postedRides.length-1]
            rideID = rideNode.Ride.rideID

            __rides.remove(rideNode);
            rideQueue.delete(rideID);

            console.log("successfuly deleted ride for", username)
        }
        catch(error){
            console.log("could not remove ride from DB: \n", error)
        }
    },

    updateRide: function(username, rideID, field, oldP, newP){
        try{
          node = __rides.remove(rideID) 
          node.Ride.field = newP
          __rides.insert(node) 
        }
        catch{
            throw Error ("could not update", rideID, "from database")
        }
    },

    findRide: function(location, dateString){
        
        //console.log("looking for rides")

        var date = new Date(dateString)
        var buffer = 2 // two hour windows

        var rides = knn(__rides, location.x, location.y, function (item) {
            
            // return item if within date/hour range
            if (item.departTime.getDay() == date.getDay()){
                if ((item.departTime.getHours() - (date.getHours()+buffer)) > 0){
                    return item
                }
                else if ((item.departTime.getHours() - (date.getHours()-buffer)) > 0){
                    return item
                }
            }

        });

        return rides
    },

    testBackup: function(username){
        console.log("size of database before backup read", __users.size)
        readBackup(username, -1)
        console.log("size after backup read", __users.size)
    },

    hash: function(password){
        return security.encryptPasword(password)
    },
}










