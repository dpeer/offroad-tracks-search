import fs from 'fs';
import axios from 'axios';
import users from './input/user-ids.json' assert {type: 'json'};

const baseTrackUrl = 'https://off-road.io/track/';
const baseSearchUrl = 'https://tracks.off-road.io/v1/tracks?limit=200&query=';
const baseLegacySearchUrl = 'https://api.off-road.io/_ah/api/tracks/filter?activityType=OffRoading';
const baseByUserUrl = 'https://api.off-road.io/_ah/api/offroadApi/v2/getMoreByUser/';
const rawDir = 'output/raw';
const partialDir = 'output/partial';

const user = users.find(user => user.ownerDisplayName === 'shay lazmi');
const filters = {
     query: '',
     adventureUserId: user ? user.myAdventureUserId : null,
     minGrade: 4,
     minReviws: 2,
     difficultyLevels: [3,5], // (1 = easy, 3 = moderate, 5 = hard)
     maxDistance: 60,
     minDistance: 20,
     minDate: new Date('2018-01-01T00:00:00'),
     geoArea: 'NEGEV_NORTH', // [CARMEL_RAMOT_MENASHE, JERUSALEM_MOUNT_SHFELA, NEGEV_CENTER_MACHTESHIM, NEGEV_NORTH]
};
filters.query = filters.query ?? '';
const allTracks = [];

const main = async () => {
     createDirIfNotExists(rawDir);
     createDirIfNotExists(partialDir);

     await getTracks();
     await getLegacyTracks();
     await getTracksByUser();

     console.log(`\nUnique tracks count: ${allTracks.length}`);
     fs.writeFileSync('output/all-tracks.json', JSON.stringify(allTracks.sort((a, b) => a.title && b.title ? a.title.localeCompare(b.title) : 1), null, 4));
}

const getTracks = async () => {
     const tracksUrl = baseSearchUrl + filters.query;
     const response = await axios.get(encodeURI(tracksUrl));
     console.log('\nTracks URL: ' + tracksUrl);

     let tracks = response.data.items;
     console.log(`Initial Tracks count = ${tracks.length}`);

     tracks = filterTracks(tracks);

     console.log(`Tracks count = ${tracks.length}`);

     fs.writeFileSync(`${rawDir}/tracks-raw.json`, JSON.stringify(tracks, null, 4));

     tracks = tracks.map(track => mapTrack(track));

     fs.writeFileSync(`${partialDir}/tracks.json`, JSON.stringify(tracks, null, 4));

     addToAllTracks(tracks);
};

const getLegacyTracks = async () => {
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

     fs.writeFileSync(`${rawDir}/legacy-tracks-raw.json`, JSON.stringify(tracks, null, 4));

     tracks = tracks.map(track => mapLegacyTrack(track));

     fs.writeFileSync(`${partialDir}/legacy-tracks.json`, JSON.stringify(tracks, null, 4));

     addToAllTracks(tracks);
};

const getTracksByUser = async () => {
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

     fs.writeFileSync(`${rawDir}/tracks-by-user-raw.json`, JSON.stringify(tracks, null, 4));

     tracks = tracks.map(track => mapLegacyTrack(track));

     fs.writeFileSync(`${partialDir}/tracks-by-user.json`, JSON.stringify(tracks, null, 4));

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
     tracks = tracks.filter(track => track.activityType === "OffRoading");
     if (filters.difficultyLevels && filters.difficultyLevels.length) {
          tracks = tracks.filter(track => filters.difficultyLevels.includes(track.difficultyLevel));
     }
     if (filters.geoArea) {
          tracks = tracks.filter(track => track.area === filters.geoArea);
     }
     if (filters.minDistance) {
          if (isLegacy) {
               tracks = tracks.filter(track => track.layersStatistics.distance >= filters.minDistance || track.layersStatistics.distance == null);
          } else {
               tracks = tracks.filter(track => track.distance >= filters.minDistance || track.distance == null);
          }
     }
     if (filters.maxDistance) {
          if (isLegacy) {
               tracks = tracks.filter(track => track.layersStatistics.distance <= filters.maxDistance || track.layersStatistics.distance == null);
          } else {
               tracks = tracks.filter(track => track.distance <= filters.maxDistance || track.distance == null);
          }
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
     if (filters.query) {
          tracks = tracks.filter(track => 
               (track.title && track.title.includes(filters.query)) || 
               (track.description && track.description.includes(filters.query)) ||
               (track.shortDescription && track.shortDescription.includes(filters.query)));
     }

     return tracks;
}

function mapTrack(track) {
     return {
          url: baseTrackUrl + track.id,
          title: track.title,
          difficultyLevel: parseDifficultyLevel(track.difficultyLevel),
          distance: Math.trunc(track.distance),
          duration: new Date(+track.duration).toISOString().substring(11, 19),
          area: track.area,
          created: new Date(track.created).toISOString().substring(0, 10),
          updated: new Date(track.updated).toISOString().substring(0, 10),
          grade: track.grade,
          reviews: track.reviews,
          ownerDisplayName: track.ownerDisplayName
     };
}

function mapLegacyTrack(track) {
     let mappedTrack = mapTrack(track);
     mappedTrack.description = track.description;
     mappedTrack.shortDescription = track.shortDescription;
     if (track.layersStatistics) {
          mappedTrack.distance = track.layersStatistics.distance;
     }
     return mappedTrack;
}

function parseDifficultyLevel(difficultyLevel) {
     switch (difficultyLevel) {
          case 5:
               return 'קשה'
          case 3:
               return 'בינוני';
          case 1:
               return 'קל';
          default:
               return '';
     }
}

function createDirIfNotExists(dir) {
     if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
     }
}

main();
