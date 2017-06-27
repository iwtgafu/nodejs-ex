import {get} from 'lodash'
import assert from 'assert'
import {addDays, httpsGet} from '../utils'
import getConnection from '../db'
import url from 'url'

const SLEEL_DURATION = 1000 * 15 * 60;
const SCAN_DEPTH = 45;

const today = new Date();
const scanFrom = addDays(today, 1)
scanPriceList(scanFrom, SCAN_DEPTH);



function scanPriceList(from, depth) {
  function scan(date, flexDays) {
    const iteration = flexDays > 6 ? 6 : flexDays

    const url = getUrl(date, iteration);
    httpsGet(url, (err, data) => {
      assert.equal(null, err);
      console.log('fetched from: ', date, iteration, ' days: ', JSON.stringify(data));

      savePriceList(data);

      if (flexDays > 6) {
        const d = addDays(date, iteration + 1);
        scan(d, flexDays - 6);
      } else {
        setTimeout(() => { scan(from, depth) }, SLEEL_DURATION);
      }
    });
  };

  scan(from, depth);
}


function savePriceList(resp) {
  if (get(resp, 'trips.0')) {
    getConnection((err, db) => {
      assert.equal(null, err);    
      db.collection('ryanairPriceLists').insert(resp);
      db.close();
    });
  }
}

function getUrl(dateout, flexDays) {
  const query = url.format({
    query: {
      ADT: 2,
      CHD: 1,
      TEEN: 0,
      INF: 1,
      Destination: 'BUD',
      Origin: 'SXF',
      DateOut: dateout,
      FlexDaysOut: flexDays,
      RoundTrip: false,
      ToUs: 'AGREED',
      exists: false
    },
  });

  return `https://desktopapps.ryanair.com/v3/en-gb/availability${query}`
}


