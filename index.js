require("dotenv").config();
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const XLSX = require('xlsx');
const { platformIds } = require('./platforms');
const { genreIds } = require('./genres');
const { ratingLookup } = require('./age_rating');
const colors = require('colors');
const { log } = require("console");

// Customize to your liking
let limit = 500; // number of results returned by each query
let maxQueries = null; // max amount of queries
let releaseDate = '1577836800'; // unix timestamp for title release date
let titleRating = '85'; // overall critic score rating of title (internal & external rating)

function convertMsToTimer(ms) {
    const secondsToComplete = Math.ceil(ms / 1000);
    const minutes = Math.floor(secondsToComplete / 60);
    const seconds = secondsToComplete % 60;
    return `${colors.yellow.bold(minutes)} ${colors.white.bold('minutes')} ${colors.yellow.bold(seconds)} ${colors.white.bold('seconds')}`;
}

// Convert ids to readable names
async function getPlatformNames(ids) {
    if (!ids) return;
    const platforms = [];
    ids.forEach(id => {
        platformIds.forEach(platform => {
            if (platform.id === id) {
                platforms.push(platform.name);
            }
        });
    });
    return platforms.join(', ');
}

// Convert ids to readable names
async function getGenreNames(ids) {
    if (!ids) return;
    const genres = [];
    ids.forEach(id => {
        genreIds.forEach(genre => {
            if (genre.id === id) {
                genres.push(genre.name);
            }
        });
    });
    return genres.join(', ');
}

// Convert ids to readable names
async function getAgeRatingNames(ids) {
    if (!ids) return;
    let ageRating;

    await fetch(
        "https://api.igdb.com/v4/age_ratings",
        {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Client-ID': process.env.CLIENT_ID,
                'Authorization': process.env.API_KEY,
            },
            body: `fields id, category, rating; where id = ${ids[0]};`
        }
    )
        .then(response => response.json())
        .then(data => {
            if (!data[0].rating) return;
            ageRating = ratingLookup[data[0].rating] || 'Unknown';
        })
        .catch(err => console.log(err))
    return ageRating;
}

// Convert ids to readable names
async function getPublisherNames(name) {
    let publisherName;
    await fetch(`https://www.google.com/search?q=${name}`, {
        method: 'GET'
    })
        .then(response => response.text())
        .then(data => {
            const $ = cheerio.load(data);
            const publisherDiv = $('div.BNeawe.s3v9rd.AP7Wnd:contains("Publisher:")').eq(0);
            publisherName = publisherDiv.find('span.BNeawe.tAd8D.AP7Wnd a span.XLloXe.AP7Wnd').text();
        })
        .catch(err => console.error(err));
    return publisherName;
}


async function getDeveloperNames(ids) {
    if (!ids) return;
    const developers = [];
    try {
        await Promise.all(ids.map(async id => {
            const response = await fetch(
                "https://api.igdb.com/v4/involved_companies",
                {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Client-ID': process.env.CLIENT_ID,
                        'Authorization': process.env.API_KEY,
                    },
                    body: `fields id, company; where id = ${id};`
                }
            );
            const involvedCompanies = await response.json();
            if (involvedCompanies.length > 0) {
                const companyId = involvedCompanies[0].company;
                const companyResponse = await fetch(
                    "https://api.igdb.com/v4/companies",
                    {
                        method: 'POST',
                        headers: {
                            'Accept': 'application/json',
                            'Client-ID': process.env.CLIENT_ID,
                            'Authorization': process.env.API_KEY,
                        },
                        body: `fields id, name; where id = ${companyId};`
                    }
                );
                const companies = await companyResponse.json();
                if (companies.length > 0) {
                    developers.push(companies[0].name);
                }
            }
        }));
    } catch (err) {
        console.error(err);
        throw err;
    }
    return developers[0];
}

async function getReleaseDate(timestamp) {
    const date = new Date(timestamp * 1000);
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const formattedDate = `${month}/${day}/${year}`;
    return formattedDate;
}

let gameDataArray = [];
let offset = 0;
let index = 1;
let added = 0;

async function populateGameData(limit, offset) {
    try {
        log(`🔎 Index ${colors.yellow.bold(index)} - Fetching ${colors.yellow.bold(limit)} titles with an offset of ${colors.yellow.bold(offset)}`);
        // Fetch game data from the IGDB API
        const response = await fetch(
            "https://api.igdb.com/v4/games",
            {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Client-ID': process.env.CLIENT_ID, // get from 'https://dev.twitch.tv/login'
                    'Authorization': process.env.API_KEY, // returned from POST request to 'https://id.twitch.tv/oauth2/token?client_id=abcdefg12345&client_secret=hijklmn67890&grant_type=client_credentials'
                },
                body: `fields id, name, platforms, total_rating, first_release_date, genres, platforms, involved_companies, summary, url, age_ratings;
                      where first_release_date > ${releaseDate} & total_rating > ${titleRating} & name != null & platforms != null;
                      limit ${limit};
                      offset ${offset};`
            }
        );
        const data = await response.json();

        if (data.length > 0) {
            const startTime = new Date();
            log(`✨ Found ${colors.yellow.bold(data.length)} titles matching your query. Approx. time to complete is ${convertMsToTimer(data.length * 2100)}`);

            for (const game of data) {
                // Create a JSON object from returned data
                const gameData = {
                    gameName: game.name,
                    ageRating: await getAgeRatingNames(game.age_ratings),
                    developers: await getDeveloperNames(game.involved_companies),
                    publishers: await getPublisherNames(game.name),
                    platforms: await getPlatformNames(game.platforms),
                    genres: await getGenreNames(game.genres),
                    releaseDate: await getReleaseDate(game.first_release_date),
                    description: game.summary,
                };
                // Add game data to the array
                gameDataArray.push(gameData);
                log(`🎮 [${colors.yellow.bold(added + 1)}] Added game data for [${colors.cyan.bold(game.id)}] ${colors.blue.bold(game.name)}`);
                added++;
            }

            const endTime = new Date();
            log(`🏁 Index ${colors.yellow.bold(index)} finished in ${colors.blue.bold(convertMsToTimer(endTime - startTime))}`);

            // Deley to prevent API rate limit (4 requests per second)
            setTimeout(() => {
                index++;
                maxQueries--;
                // If maxQueries is null, this function will run again until no results are returned
                if (maxQueries == null || maxQueries !== 0) {
                    populateGameData(limit, offset + limit);
                }
            }, 250);
        } else {
            log(`✨ Found ${colors.yellow.bold(data.length)} titles matching your query`);
            console.log(`✅ Completed - added ${colors.yellow.bold(added)} titles`);
        }

        // Write game data to JSON file
        fs.writeFile('gameData.json', JSON.stringify(gameDataArray, null, 2), 'utf8', (err) => {
            if (err) return console.error('Error writing to the output file:', err);
            // Read the JSON data from the new file and create a spreadsheet out of it
            const jsonData = fs.readFileSync('gameData.json', 'utf8');
            const data = JSON.parse(jsonData);
            const worksheet = XLSX.utils.json_to_sheet(data);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'sheet');
            // Generate the spreadsheet file
            XLSX.writeFile(workbook, 'gameData.xlsx');
        });
    } catch (err) {
        console.error(err);
        throw err;
    }
}

populateGameData(limit, offset);