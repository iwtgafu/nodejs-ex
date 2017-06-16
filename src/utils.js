import https from 'https';

export function addDays(date, days) {
  var d = new Date(date);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function httpsGet(url, callback) {

  return https.get(url, function (response) {

    const { statusCode } = response;
    if (statusCode !== 200) {
      response.resume(); // consume response data to free up memory
      callback(statusCode);
    }

    // Continuously update stream with data
    var body = '';
    response.on('data', function (d) {
      body += d;
    });
    response.on('end', function () {
      // Data reception is done, do whatever with it!
      callback(undefined, JSON.parse(body));
    });
  });
};
