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
      fs.readFile(fileName, 'utf8', (err, data) => {
        const ryanairPrices = !err ? updatePriceLists(JSON.parse(data), nextPriceList) : nextPriceList;

        fs.writeFile(fileName, JSON.stringify(ryanairPrices), 'utf8', (err, data) => {
          if (err) console.log(err);
          const timeout = 1000 * 5 * 60;
          setTimeout(() => { scanForPriceFn() }, timeout);
        });
      });
    }
  });
};

function updatePriceLists(prev, next) {
  const priceList = prev.priceList.map(item => {

    const nextPrices = _.get(_.find(next.priceList, np => np.dateOut === item.dateOut), 'prices');
    const nextPrice = _.get(_.last(nextPrices), 'price');
    const price = _.get(_.last(item.prices), 'price');

    const nextFaresLeft = _.get(_.last(nextPrices), 'faresLeft');
    const faresLeft = _.get(_.last(item.prices), 'faresLeft');

    if (price === nextPrice && nextFaresLeft === faresLeft) {
      return item
    } else {
      return Object.assign({}, item, { prices: item.prices.concat(nextPrices) });
    };
  });

  return {
    priceList,
    serverTimeUTC: next.serverTimeUTC
  }
}

const today = new Date();
const scanFrom = addDays(today, 1)
const scanForPriceFn = scanForPrice.bind(null, scanFrom, 45)
scanForPriceFn();


function mapper() {
  var dates = this.trips[0].dates
  dates.forEach(function (date) {
    var amount = date.flights[0].regularFare.fares[0].amount
    emit(date.dateOut, { amount: amount, serverTimeUTC: this.serverTimeUTC })
  });
};

function reducer(key, values) {
  var result = values.reduce(function (result, value) {
    if (result.length === 0 || result[result.length - 1].amount !== value.amount) {
      result.push(value)
    }
    return result;
  }, []);

  return { prices: result }
};


var options = {
  out: {
    merge: "prices",
  },
};


function savePriceList(resp) {
  getConnection((err, db) => {
    if (!err) {
      var priceLists = db.collection('ryanairPriceLists');
      priceLists.insert(resp);
    }
  });
}