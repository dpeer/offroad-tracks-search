import fs from 'fs';
import axios from 'axios';
import {users} from './input/user-ids.js';
import path from 'path';

const baseTrackUrl = 'https://off-road.io/track/';
const baseSearchUrl = 'https://tracks.off-road.io/v1/tracks?limit=200&query=';
const baseLegacySearchUrl = 'https://api.off-road.io/_ah/api/tracks/filter?activityType=OffRoading';
const baseByUserUrl = 'https://api.off-road.io/_ah/api/offroadApi/v2/getMoreByUser/';
const outputDir = 'output';
const rawDir = path.join(outputDir, 'raw');
const partialDir = path.join(outputDir, 'partial');

const user = users.find(user => user.ownerDisplayName === '');
const filters = {
     freeText: '',
     adventureUserId: user ? user.myAdventureUserId : null,
     minGrade: 4,
     minReviws: 2,
     difficultyLevels: [1,3,5], // (1 = easy, 3 = moderate, 5 = hard)
     maxDistance: 80,
     minDistance: 20,
     minDate: new Date('2018-01-01T00:00:00'),
     geoArea: 'GALIL_BOT_AMAKIM_GILBOA',
};
const allTracks = [];

await searchTracks();

async function searchTracks() {
     createDirIfNotExists(rawDir);
     createDirIfNotExists(partialDir);

     await Promise.allSettled([getTracks(), getLegacyTracks(), getTracksByUser()]);

     console.log(`\nUnique tracks count: ${allTracks.length}`);
     const sortedTracks = allTracks.sort((a, b) => a.title && b.title ? a.title.localeCompare(b.title) : 1);
     writeFilePrettySync(path.join(outputDir, 'all-tracks.json'), sortedTracks);
}

async function getTracks() {
     const tracksUrl = baseSearchUrl + filters.freeText;
     const response = await axios.get(encodeURI(tracksUrl));
     console.log('\nTracks URL: ' + tracksUrl);

     let tracks = response.data.items;
     console.log(`Initial Tracks count = ${tracks.length}`);

     tracks = filterTracks(tracks);

     console.log(`Tracks count = ${tracks.length}`);

     writeFilePrettySync(`${rawDir}/tracks-raw.json`, tracks);

     tracks = tracks.map(track => mapTrack(track));

     writeFilePrettySync(path.join(partialDir, 'tracks.json'), tracks);

     addToAllTracks(tracks);
}

async function getLegacyTracks() {
     let tracksUrl = baseLegacySearchUrl;
     let difficultyLevels = '';
     if (filters.difficultyLevels && filters.difficultyLevels.length) {
          tracksUrl += '&diffLevel=';
          if (filters.difficultyLevels.includes(1)) {
               difficultyLevels += 'easy,';
          }
          if (filters.difficultyLevels.includes(3)) {
               difficultyLevels += 'moderate,';
          } 
          if (filters.difficultyLevels.includes(5)) {
               difficultyLevels += 'hard,';
          }
          tracksUrl += difficultyLevels.slice(0, -1);
     }
     if (filters.geoArea) {
          tracksUrl += `&area=${filters.geoArea}`;
     }
     
     const response = await axios.get(encodeURI(tracksUrl))
     console.log('\nLegacy URL: ' + tracksUrl);
     
     let tracks = response.data.items.map(item => item.track);
     console.log(`Initial Legacy tracks count = ${tracks.length}`);

     tracks = filterTracks(tracks, true);
     
     console.log(`Legacy tracks count = ${tracks.length}`);

     writeFilePrettySync(`${rawDir}/legacy-tracks-raw.json`, tracks);

     tracks = tracks.map(track => mapLegacyTrack(track));

     writeFilePrettySync(path.join(partialDir, 'legacy-tracks.json'), tracks);

     addToAllTracks(tracks);
}

async function getTracksByUser() {
     if (!filters.adventureUserId) {
          return;
     }
     const tracksUrl = baseByUserUrl + filters.adventureUserId;
     const response = await axios.get(encodeURI(tracksUrl))
     console.log('\nTracks by user URL: ' + tracksUrl);

     let tracks = response.data.trackResults.map(item => item.track);
     console.log(`Initial Tracks by user [${response.data.userDisplayName}] count = ${tracks.length}`);

     tracks = filterTracks(tracks, true);

     console.log(`Tracks by user count = ${tracks.length}`);

     writeFilePrettySync(`${rawDir}/tracks-by-user-raw.json`, tracks);

     tracks = tracks.map(track => mapLegacyTrack(track));

     writeFilePrettySync(path.join(partialDir, 'tracks-by-user.json'), tracks);

     addToAllTracks(tracks);
};

function addToAllTracks(tracks) {
     tracks.forEach(track => {
          const idx = allTracks.findIndex(t => t.url === track.url);
          if (idx === -1) {
               allTracks.push(track);
          } else {
               allTracks[idx] = { ...track, ...allTracks[idx]};
          }
     });
}

function filterTracks(tracks, isLegacy) {
     const trackDistanceGetter = (track) => isLegacy ? track.layersStatistics.distance : track.distance;

     tracks = tracks.filter(track => track.activityType === "OffRoading");
     if (filters.difficultyLevels && filters.difficultyLevels.length) {
          tracks = tracks.filter(track => filters.difficultyLevels.includes(track.difficultyLevel));
     }
     if (filters.geoArea) {
          tracks = tracks.filter(track => track.area === filters.geoArea);
     }
     if (filters.minDistance) {
          tracks = tracks.filter(track => (trackDistanceGetter(track) ?? Number.MAX_SAFE_INTEGER) >= filters.minDistance);
     }
     if (filters.maxDistance) {
          tracks = tracks.filter(track => (trackDistanceGetter(track) ?? 0) <= filters.maxDistance);
     }
     if (filters.minGrade) {
          tracks = tracks.filter(track => track.grade >= filters.minGrade);
     }
     if (filters.minReviws) {
          tracks = tracks.filter(track => track.reviews >= filters.minReviws);
     }
     if (filters.minDate) {
          tracks = tracks.filter(track => new Date(track.created) - filters.minDate > 0 || new Date(track.created) - filters.minDate);
     }
     if (filters.freeText) {
          tracks = tracks.filter(track => 
               (track.title && track.title.includes(filters.freeText)) || 
               (track.description && track.description.includes(filters.freeText)) ||
               (track.shortDescription && track.shortDescription.includes(filters.freeText)));
     }

     return tracks;
}

function dateParser(time) {
     return new Date(time).toISOString().substring(0, 10);
}

function mapTrack(track) {
     return {
          url: baseTrackUrl + track.id,
          title: track.title,
          difficultyLevel: parseDifficultyLevel(track.difficultyLevel),
          distance: Math.trunc(track.distance),
          duration: new Date(+track.duration).toISOString().substring(11, 19),
          area: track.area,
          created: dateParser(track.created),
          updated: dateParser(track.updated),
          grade: track.grade,
          reviews: track.reviews,
          ownerDisplayName: track.ownerDisplayName
     };
}

function mapLegacyTrack(track) {
     return {
          ...mapTrack(track),
          description: track.description,
          shortDescription: track.shortDescription,
          distance: track.layersStatistics ? track.layersStatistics.distance : null
     };
}

function parseDifficultyLevel(difficultyLevel) {
     switch (difficultyLevel) {
          case 5:
               return 'Hard'
          case 3:
               return 'Moderate';
          case 1:
               return 'Easy';
          default:
               return 'N/A';
     }
}

function createDirIfNotExists(dir) {
     if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
     }
}

function writeFilePrettySync(path, data) {
     fs.writeFileSync(path, JSON.stringify(data, null, 4));
}
