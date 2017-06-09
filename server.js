//  OpenShift sample Node application
var express = require('express'),
    fs      = require('fs'),
    app     = express(),
    eps     = require('ejs'),
    morgan  = require('morgan');

var _ = require('lodash');
var https = require('https');


Object.assign=require('object-assign')

app.engine('html', require('ejs').renderFile);
app.use(morgan('combined'))

var port = process.env.PORT || process.env.OPENSHIFT_NODEJS_PORT || 8080,
    ip   = process.env.IP   || process.env.OPENSHIFT_NODEJS_IP || '0.0.0.0',
    mongoURL = process.env.OPENSHIFT_MONGODB_DB_URL || process.env.MONGO_URL,
    mongoURLLabel = "";

if (mongoURL == null && process.env.DATABASE_SERVICE_NAME) {
  var mongoServiceName = process.env.DATABASE_SERVICE_NAME.toUpperCase(),
      mongoHost = process.env[mongoServiceName + '_SERVICE_HOST'],
      mongoPort = process.env[mongoServiceName + '_SERVICE_PORT'],
      mongoDatabase = process.env[mongoServiceName + '_DATABASE'],
      mongoPassword = process.env[mongoServiceName + '_PASSWORD']
      mongoUser = process.env[mongoServiceName + '_USER'];

  if (mongoHost && mongoPort && mongoDatabase) {
    mongoURLLabel = mongoURL = 'mongodb://';
    if (mongoUser && mongoPassword) {
      mongoURL += mongoUser + ':' + mongoPassword + '@';
    }
    // Provide UI label that excludes user id and pw
    mongoURLLabel += mongoHost + ':' + mongoPort + '/' + mongoDatabase;
    mongoURL += mongoHost + ':' +  mongoPort + '/' + mongoDatabase;

  }
}
var db = null,
    dbDetails = new Object();

var initDb = function(callback) {
  if (mongoURL == null) return;

  var mongodb = require('mongodb');
  if (mongodb == null) return;

  mongodb.connect(mongoURL, function(err, conn) {
    if (err) {
      callback(err);
      return;
    }

    db = conn;
    dbDetails.databaseName = db.databaseName;
    dbDetails.url = mongoURLLabel;
    dbDetails.type = 'MongoDB';

    console.log('Connected to MongoDB at: %s', mongoURL);
  });
};

app.get('/', function (req, res) {
  // try to initialize the db on every request if it's not already
  // initialized.
  if (!db) {
    initDb(function(err){});
  }
  if (db) {
    var col = db.collection('counts');
    // Create a document with request IP and current time of request
    col.insert({ip: req.ip, date: Date.now()});
    col.count(function(err, count){
      res.render('index.html', { pageCountMessage : count, dbInfo: dbDetails });
    });
  } else {
    res.render('index.html', { pageCountMessage : null});
  }
});

app.get('/pagecount', function (req, res) {
  // try to initialize the db on every request if it's not already
  // initialized.
  if (!db) {
    initDb(function(err){});
  }
  if (db) {
    db.collection('counts').count(function(err, count ){
      res.send('{ pageCount: ' + count + '}');
    });
  } else {
    res.send('{ pageCount: -1 }');
  }
});



function httpsGet(url, callback) {

  return https.get(url, function (response) {
    // Continuously update stream with data
    var body = '';
    response.on('data', function (d) {
      body += d;
    });
    response.on('end', function () {
      // Data reception is done, do whatever with it!
      callback(JSON.parse(body));
    });
  });
};


function addDays(date, days) {
    var d = new Date(date);
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}

function getUrl(dateout, flexDays) {
  return `https://desktopapps.ryanair.com/v3/en-gb/availability?ADT=2&CHD=1&DateOut=${dateout}&Destination=BUD&FlexDaysOut=${flexDays}&INF=1&Origin=SXF&RoundTrip=false&TEEN=0&exists=false`
}


function transformResponse(onTransformed) {
  return function(resp) {
    // console.log(JSON.stringify(resp));
    onTransformed && onTransformed({
      serverTimeUTC: resp.serverTimeUTC,
      priceList: resp.trips[0].dates.map(date => {
        const price = +date.flights[0].regularFare.fares[0].amount;
        const faresLeft = date.flights[0].faresLeft;

        return {
          dateOut: date.dateOut,
          prices: [{
            price,
            serverTimeUTC: resp.serverTimeUTC,
            faresLeft,
          }],
        }
      }),
    });
  }
}

function mergePriceList(prev, next) {
  if (!prev) {
    return next
  } else {
    return Object.assign({}, next, {priceList: prev.priceList.concat(next.priceList)});
  }
}

var ryanairPrices;
function scanForPrice(date, flexDays, prevPriceList) {
  const iteration = flexDays > 6 ? 6 : flexDays
  const url = getUrl(date, iteration);
  httpsGet(url, transformResponse((resp) => {
    const nextPriceList = mergePriceList(prevPriceList, resp);
    if (flexDays > 6) {
      const d = addDays(date, iteration + 1);
      scanForPrice(d, flexDays - 6, nextPriceList);
    } else {
      ryanairPrices = ryanairPrices ? updatePriceLists(ryanairPrices, nextPriceList) : nextPriceList;
      const timeout = 1000 * 5 * 60;
      setTimeout(() => {scanForPriceFn()}, timeout);
    }
  }));
};


const begin = '2017-06-12';
const today = new Date();
const scanFrom = new Date(begin) > today ? begin : `${today.getFullYear()}-${today.getMonth()+1}-${today.getDate()}`
const scanForPriceFn = scanForPrice.bind(null, '2017-06-22', 40)
scanForPriceFn();


function updatePriceLists(prev, next) {
  const priceList = prev.priceList.map(item => {

    const nextPrices = next.priceList.find(np => np.dateOut === item.dateOut).prices;
    const nextPrice = _.get(_.last(nextPrices), 'price');
    const price = _.get(_.last(item.prices), 'price');

    const nextFaresLeft = _.get(_.last(nextPrices), 'faresLeft');
    const faresLeft = _.get(_.last(item.prices), 'faresLeft');

    if (price === nextPrice && nextFaresLeft === faresLeft) {
      return item
    } else {
      return Object.assign({}, item, {prices: item.prices.concat(nextPrices)});
    };
  });

  return {
    priceList,
    serverTimeUTC: next.serverTimeUTC
  }
}


app.get('/api/ryanair/pricelist', function (req, res) {
  ryanairPrices && res.json(ryanairPrices);
});

// error handling
app.use(function(err, req, res, next){
  console.error(err.stack);
  res.status(500).send('Something bad happened!');
});

initDb(function(err){
  console.log('Error connecting to Mongo. Message:\n'+err);
});

app.listen(port, ip);
console.log('Server running on http://%s:%s', ip, port);




module.exports = app ;
