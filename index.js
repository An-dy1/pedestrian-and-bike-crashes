const keys = require('./keys.js');
const axios = require('axios');
const path = require('path');
const fs = require('fs-extra');
const { TwitterApi } = require('twitter-api-v2');
const argv = require('minimist')(process.argv.slice(2));

const assetDirectory = `./assets-${argv.location}`;

/**
 * Temporarily halts program execution.
 * @param {Number} ms number of miliseconds to wait
 * @returns promise
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Makes a GET request to Citizen to fetch 200 recent incidents. Using 200 because I think that
 * shgould be a high enough limit to grab all incidents for a given day.
 * @returns JSON list of incidents.
 */
const fetchIncidents = async () => {
  const response = await axios({
    url: `https://citizen.com/api/incident/trending?lowerLatitude=${
      keys[argv.location].lowerLatitude
    }&lowerLongitude=${keys[argv.location].lowerLongitude}&upperLatitude=${
      keys[argv.location].upperLatitude
    }&upperLongitude=${
      keys[argv.location].upperLongitude
    }&fullResponse=true&limit=200`,
    method: 'GET',
  }).catch((error) => {
    console.log('error fetching incidents' + error);
  });

  console.log(response.data.results);
  return response.data.results;
};

/**
 * Makes a GET request to download a map image of an incident.
 * @param {String} url url of the image to download
 * @param {String} eventKey the ID of the citizen incident
 * @returns resolved promise.
 */
const downloadMapImage = async (url, eventKey) => {
  const imagePath = path.resolve(
    __dirname,
    `${assetDirectory}/${eventKey}.png`
  );
  const writer = fs.createWriteStream(imagePath);

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
  });

  return new Promise((resolve) =>
    response.data.pipe(writer).on('finish', resolve)
  );
};

/**
 * Deletes asset folder from disk, and then re-creates it.
 */
const resetAssetsFolder = () => {
  fs.removeSync(assetDirectory);
  fs.ensureDirSync(assetDirectory);
};

/**
 * Tweets thread on a Citizen incident that includes a Pedestrian or Bicyclist
 * @param {*} client the instantiated Twitter client
 * @param {*} incident the Citizen incident to tweet
 */
const tweetIncidentThread = async (client, incident) => {
  const incidentDate = new Date(incident.ts).toLocaleString('en-US', {
    timeZone: keys[argv.location].timeZone,
  });
  const tweets = [];

  // Upload map image and add alt text
  const mediaId = await client.v1
    .uploadMedia(`${assetDirectory}/${incident.key}.png`)
    .catch((error) => {
      console.log('error uploading media' + error);
    });
  await client.v1
    .createMediaMetadata(mediaId, {
      alt_text: { text: `A photo of a map at ${incident.address}` },
    })
    .catch((error) => {
      console.log('error creating media metadata' + error);
    });

  // Add initial tweet with map image linked
  tweets.push({
    text: `${incident.raw}\n\n${incidentDate}`,
    media: { media_ids: [mediaId] },
  });

  for (const updateKey in incident.updates) {
    if (incident.updates[updateKey].type != 'ROOT') {
      const updateTime = new Date(
        incident.updates[updateKey].ts
      ).toLocaleString('en-US', { timeZone: keys[argv.location].timeZone });
      tweets.push(`${incident.updates[updateKey].text}\n\n${updateTime}`);
    }
  }

  await client.v2.tweetThread(tweets).catch((error) => {
    console.log('error tweeting thread');
  });
};

/**
 * Filters Citizen incidents and returns ones involving Pedestrian and Bicyclists.
 * @param {Array} allIncidents an array of Citizen incidents
 * @returns an array of Citizen incidents mentioning Pedestrians or Bicyclists.
 */
const filterIncidents = (allIncidents) => {
  const yesterdayTimestampInMs = Date.now() - 86400000;

  // Get incidents from the last 24 hours with pedestrian or bicyclist in the top level description
  const relevantIncidents = allIncidents
    .filter((x) => x.ts >= yesterdayTimestampInMs)
    .filter(
      (x) =>
        !x.raw.toLowerCase().includes('robbed') &&
        !x.raw.toLowerCase().includes('burglary') &&
        !x.title.toLowerCase().includes('robbed') &&
        !x.title.toLowerCase().includes('burglary')
    )
    .filter(
      (x) =>
        x.raw.toLowerCase().includes('pedestrian') ||
        x.raw.toLowerCase().includes('bicyclist') ||
        x.raw.toLowerCase().includes('struck by vehicle') ||
        x.raw.toLowerCase().includes('bicycle') ||
        x.raw.toLowerCase().includes('scooter') ||
        x.title.toLowerCase().includes('pedestrian') ||
        x.title.toLowerCase().includes('bicyclist') ||
        x.title.toLowerCase().includes('struck by vehicle') ||
        x.title.toLowerCase().includes('bicycle') ||
        x.title.toLowerCase().includes('scooter')
    );

  // Get incidents from the last 24 hours with pedestrian or bicyuclist in an update
  // It's possible an incident could have a description that doesn't involve a pedestrian
  // or bicyclist but in a 911 update Citizen later learns they were involved
  const incidentsWithRelevantUpdates = allIncidents
    .filter((x) => x.ts >= yesterdayTimestampInMs)
    .filter((x) => {
      for (const updateObjectKey in x.updates) {
        const updateText = x.updates[updateObjectKey].text.toLowerCase();
        if (
          updateText.includes('robbed') ||
          updateText.includes('burglary') ||
          updateText.includes('breaking into')
        ) {
          return false;
        } else if (
          updateText.includes('pedestrian') ||
          updateText.includes('bicyclist') ||
          updateText.includes('struck by vehicle') ||
          updateText.includes('bicycle') ||
          updateText.includes('scooter')
        ) {
          return true;
        }
      }
      return false;
    });

  return Array.from(
    new Set([...relevantIncidents, ...incidentsWithRelevantUpdates])
  );
};

const main = async () => {
  if (argv.location == undefined || argv.location == null) {
    console.log('Location must be passed in');
    return;
  }

  console.log('app key: ' + keys[argv.location].consumer_key);

  resetAssetsFolder();

  const allIncidents = await fetchIncidents();
  const filteredIncidents = filterIncidents(allIncidents);
};

main();
