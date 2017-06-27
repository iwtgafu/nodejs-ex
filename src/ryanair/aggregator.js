import getConnection from '../db'
import assert from 'assert'


function mapper () { 
  if (!this.trips || this.trips.length < 1) return;
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


function aggregate(callback) {
  getConnection((err, db) => {
    assert.equal(null, err);    
    db.collection('ryanairPriceLists').mapReduce(mapper, reducer, options, function(err, collection, stats) {
      assert.equal(null, err);    
      collection.find().toArray(function(err, docs) {
        assert.equal(null, err);
        callback(docs);
        db.close();
      });
    });
  });
}

function getLastPriceList(callback) {
  getConnection((err, db) => {
    console.log('getLastPriceList')
    assert.equal(null, err);    
    db.collection('ryanairPriceLists').find().sort({serverTimeUTC: -1}).limit(1).toArray(function(err, lastPriceList) {
      assert.equal(null, err);    
      callback(lastPriceList);
      db.close();
    })
  })
}

export default function getPriceLists(callback) {
  aggregate((priceLists) => {
    getLastPriceList((lastPriceList) => {
      const response = {
        priceLists: priceLists,
        serverTimeUTC: lastPriceList && lastPriceList.length > 0 && lastPriceList[0].serverTimeUTC,
      }
      callback(response);
    })
  })
}

