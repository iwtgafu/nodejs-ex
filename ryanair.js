var _ = require('lodash');
var https = require('https');
var fs = require('fs');
var getConnection = require('./db');

const fileName = './ryanair.json';

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
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function getUrl(dateout, flexDays) {
  return `https://desktopapps.ryanair.com/v3/en-gb/availability?ADT=2&CHD=1&DateOut=${dateout}&Destination=BUD&FlexDaysOut=${flexDays}&INF=1&Origin=SXF&RoundTrip=false&TEEN=0&exists=false`
}


function transformResponse(resp) {
    // console.log(JSON.stringify(resp));
  return {
    serverTimeUTC: resp.serverTimeUTC,
    priceList: _.map(_.get(resp, 'trips[0].dates'), date => {
      const price = _.get(date, 'flights[0].regularFare.fares[0].amount', 0);
      const faresLeft = _.get(date, 'flights[0].faresLeft');

      return {
        dateOut: date.dateOut,
        prices: [{
          price,
          serverTimeUTC: resp.serverTimeUTC,
          faresLeft,
        }],
      }
    })
  }
}

function mergePriceList(prev, next) {
  if (!prev) {
    return next
  } else {
    return Object.assign({}, next, { priceList: prev.priceList.concat(next.priceList) });
  }
}


function scanForPrice(date, flexDays, prevPriceList) {
  const iteration = flexDays > 6 ? 6 : flexDays
  const url = getUrl(date, iteration);
  httpsGet(url, (data) => {
    savePriceList(data);
    const resp = transformResponse(data);
    const nextPriceList = mergePriceList(prevPriceList, resp);
    if (flexDays > 6) {
      const d = addDays(date, iteration + 1);
      scanForPrice(d, flexDays - 6, nextPriceList);
    } else {
      const timeout = 1000 * 15 * 60;
      setTimeout(() => { scanForPriceFn() }, timeout);
    }
  });
};

const today = new Date();
const scanFrom = addDays(today, 1)
const scanForPriceFn = scanForPrice.bind(null, scanFrom, 45)
scanForPriceFn();


function mapper () { 
    const dates = this.trips[0].dates
    const serverTimeUTC = this.serverTimeUTC

    dates.forEach(function(date) {
        const flight = date && date.flights && date.flights.length > 0 && date.flights[0];
        const faresLeft = flight && flight.faresLeft;
        const fare = flight && flight.regularFare && flight.regularFare.fares && flight.regularFare.fares.length > 0 && flight.regularFare.fares[0];
        const amount = fare && fare.amount

        if (amount) {
          emit(date.dateOut, {prices: [{faresLeft: faresLeft, amount: amount, serverTimeUTC: serverTimeUTC}]})
        }
    });
};

function reducer(key, values) {
  var result = values.reduce(function (result, value) {
    const nextPriceList = result[result.length - 1];
    const lastPriceList = value.prices[value.prices.length - 1]
    
    if (result.length === 0 || nextPriceList.amount !== lastPriceList.amount || nextPriceList.faresLeft !== lastPriceList.faresLeft) {
      return result.concat(value.prices)
    }
    return result;
  }, []);

  return {prices: result}
};


var options = {
  out:  "prices",
};


function savePriceList(resp) {
  getConnection((err, db) => {
    if (!err) {
      var priceLists = db.collection('ryanairPriceLists');
      priceLists.insert(resp);
    } else {
      console.log(err)
    }
  });
}

function getPrices(callback) {
    getConnection((err, db) => {
    if (!err) {
      var priceLists = db.collection('ryanairPriceLists');
      priceLists.mapReduce(mapper, reducer, options, function(err, collection, stats) {
          if (!err) {
            collection.find().toArray(function(err, docs) {
              if (!err) {
                callback(err, docs);
              } else {
                console.log(err)
              }
            });
          } else {
            console.log(err)
          }
      });
    } else {
      console.log(err)
    }
  });
}

module.exports = getPrices;