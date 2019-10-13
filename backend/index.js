const express = require('express')
const app = express()
const port = 8000

app.get("/", (req, res) =>{
    res.send("Welcome!");
}) 

app.listen(port, () => {
    console.log("Hi!");
})