var cluster = require('cluster');

if (cluster.isMaster) {
	cluster.fork();
	cluster.on('exit', function(worker, code, signal) {
		cluster.fork();
	});
}

if (cluster.isWorker) {
    var express = require('express');
    var app = express();
    var bodyParser = require('body-parser');
    var NodeGeocoder = require('node-geocoder');
    const puppeteer = require('puppeteer');
    var request = require('request');
    var bearerToken = null;
    var mysql = require('mysql');
	var pool = mysql.createPool({
	  host: "localhost",
	  user: "root",
	  password: "",
	  database: "foodnow_db"
	});

    var getBearerToken = async function () {
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox']
        });
        const page = await browser.newPage();
        await page.goto("https://www.grubhub.com/search?orderMethod=delivery&locationMode=DELIVERY&facetSet=umamiV2&pageSize=20&hideHateos=true&searchMetrics=true&latitude=38.95862960&longitude=-77.35700226&facet=open_now%3Atrue&sortSetId=umamiV2&sponsoredSize=3&countOmittingTimes=true", {
            waitUntil: "networkidle2"
        });

        await page.setRequestInterception(true);

        page.on("request", req => {
            var keyArr = Object.keys(req.headers());
            var valArr = Object.values(req.headers());
            for (var i = 0; i < keyArr.length; i++) {
                if (keyArr[i] == 'authorization') {
                    bearerToken = valArr[i];
                    console.log(bearerToken);
                    return;
                }
            }
            req.continue();
        });
        setTimeout(getBearerToken, 1000 * 60);
    }

    getBearerToken();

    var GetRestaurantOnePageResult = async function(searchId, pageNum, latitude, longitude) {
        
    }

    app.use(function (req, res, next) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, content-type');
        res.setHeader('Access-Control-Allow-Credentials', true);
        next();
    });

    var options = {
        provider: 'google',
        httpAdapter: 'https',
        apiKey: 'AIzaSyBWh5T6NjsE5xPTuF6Qh_sS9hEFvWFCrQE',
        formatter: null
    };

    var geocoder = NodeGeocoder(options);

    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({
        extended: true
    }));

    app.post('/get_restaurant_data', function (req, res) {
        if (bearerToken == null) {
            return res.json({
                status: false,
                message: 'Authorization Failed. Try again after 10 seconds.'
            });
        }
        var countryName = req.body.country;
        var cityName = req.body.city;
        var restaurantName = req.body.restaurant;

        geocoder.geocode({
            address: cityName,
            country: countryName
        })
            .then(function (resp1) {

                const latitude = resp1[0].latitude;
                const longitude = resp1[0].longitude;

                var url = 'https://api-gtm.grubhub.com/restaurants/search?orderMethod=delivery&locationMode=DELIVERY&facetSet=umamiV2&pageSize=20&hideHateos=true&searchMetrics=true&location=POINT(' + longitude + ' ' + latitude + ')&sortSetId=umamiV2&sponsoredSize=3&countOmittingTimes=true&pageNum=1';
                request({
                    url: url,
                    headers: {
                        'Authorization': bearerToken
                    },
                    rejectUnauthorized: false
                }, function (err2, resp2) {
                    if (err2) {
                        return res.json({
                            status: false,
                            message: 'Failed to get data from grubhub.'
                        });
                    } else {
                        const response = JSON.parse(resp2.body);
                        const searchId = response.search_id;
                        const searchResult = response.search_result;
                        var totalPages = searchResult.pager.total_pages;
                        totalPages = totalPages > 10 ? 10 : totalPages;
                        var restResult = searchResult.results;
                        
                        for (var i = 0; i < restResult.length; i++) {
                            if (restaurantName.trim().toLowerCase() == restResult[i].name.toLowerCase()) {
                                restId = restResult[i].restaurant_id;
                                break;
                            }
                        }
                        while (restId == 0 && pageNum < totalPages) {
                            pageNum++;
                            const nextPageUrl = 'https://api-gtm.grubhub.com/restaurants/search/search_listing?orderMethod=delivery&locationMode=DELIVERY&facetSet=umamiV2&pageSize=20&hideHateos=true&searchMetrics=true&location=POINT(' + longitude + ' ' + latitude + ')&sortSetId=umamiV2&sponsoredSize=3&countOmittingTimes=true&pageNum=' + pageNum + '&searchId=' + searchId;
                            request({
                                url: nextPageUrl,
                                headers: {
                                    'Authorization': bearerToken
                                },
                                rejectUnauthorized: false
                            }, function (err3, resp3) {
                                if (err3) {
                                    return res.json({
                                        status: false,
                                        message: 'Failed to get data from grubhub.'
                                    });
                                } else {
                                    restResult = JSON.parse(resp3.body).results;
                                    for (var i = 0; i < restResult.length; i++) {
                                        if (restaurantName.trim().toLowerCase() == restResult[i].name.toLowerCase()) {
                                            restId = restResult[i].restaurant_id;
                                            break;
                                        }
                                    }
                                }
                            })
                        }
                        if (restId != 0) {
                            console.log("pageNum: " + pageNum);
                            console.log("found restId: " + restId);
                            
                        }
                        setTimeout(function () {
                            if (restId == 0) {
                                return res.json({
                                    status: false,
                                    message: 'Invalid restaurant name in this area. Please input valid restaurant name.'
                                });
                            }
                        }, 5000);
                    }
                });
            })
            .catch(function (err1) {
                return res.json({
                    status: false,
                    message: 'Failed to get location information. Please input valid location.'
                });
            })
    });

    app.post('/store_restaurant_data', function(req, res) {
        
        if (bearerToken == null) {
            return res.json({
                status: false,
                message: 'Authorization Failed.'
            });
        }

        var latitude = req.body.latitude;
        var longitude = req.body.longitude;

        var url = 'https://api-gtm.grubhub.com/restaurants/search?orderMethod=delivery&locationMode=DELIVERY&facetSet=umamiV2&pageSize=100&hideHateos=true&searchMetrics=true&radius=10000&location=POINT(' + longitude + '%20' + latitude + ')&sortSetId=umamiV2&sponsoredSize=0&countOmittingTimes=true';
        
        request({
            url: url,
            headers: {
                'Authorization': bearerToken
            },
            rejectUnauthorized: false
        }, function (err2, resp2) {
            if (err2) {
                return res.json({
                    status: false,
                    message: 'Failed to get data from grubhub.'
                });
            } else {
                const response = JSON.parse(resp2.body);
                const searchId = response.search_id;
                const searchResult = response.search_result;
                var restResult = searchResult.results;
                var totalPages = searchResult.pager.total_pages;

                var query = "INSERT INTO restaurants (rest_id, name, logo, description, phone_number, address_country, address_locality, address_region, address_postal_code, address_street, latitude, longitude, price_rating, open) VALUES ";

                for (var i = 0; i < restResult.length - 1; i++) {
                    var rest_id = restResult[i].restaurant_id;
                    var name = restResult[i].name;
                    var logo = restResult[i].logo;
                    var description = restResult[i].description;
                    var phone_number = "+" + restResult[i].phone_number.country_code + " " + restResult[i].phone_number.phone_number;
                    var address_country = restResult[i].address.address_country;
                    var address_locality = restResult[i].address.address_locality;
                    var address_region = restResult[i].address.address_region;
                    var address_postal_code = restResult[i].address.postal_code;
                    var address_street = restResult[i].address.street_address;
                    var latitude = restResult[i].address.latitude;
                    var longitude = restResult[i].address.longitude;
                    var price_rating = restResult[i].price_rating;
                    var open = restResult[i].open;

                    query += '(' + rest_id 
                            + ',"' + name 
                            + '","' + logo
                            + '","' + description
                            + '","' + phone_number
                            + '","' + address_country
                            + '","' + address_locality
                            + '","' + address_region
                            + '","' + address_postal_code
                            + '","' + address_street
                            + '",' + latitude
                            + ',' + longitude
                            + ',' + price_rating
                            + ',' + open
                            + '),';
                }

                query = query.substring(0, query.length - 1);
                query += ";";

                pool.getConnection(function(err, connection) {
                    if (err) 
                        return res.json({
                            status: false,
                            message: 'Failed to get restaurants.'
                        });
                    connection.query(query, async function (error, results, fields) {
                        connection.release();
                        if (error) {
                            return res.json({
                                status: false,
                                message: 'Failed to get restaurants.'
                            });
                        }
                        
                        console.log("Page 1 has been stored to the database.");
                        
                        var pageNum = 1;                        

                        while (pageNum < totalPages) {
                            await GetRestaurantOnePageResult(searchId, pageNum, latitude, longitude);
                            pageNum++;
                        }

                        return res.json({
                            status: false,
                            message: 'Storing data to the database finished successfully.'
                        });
                    });
                });
            }
        });
    });

    app.post('/ddd', function(req,res) {

        if (bearerToken == null) {
            return res.json({
                status: false,
                message: 'Authorization Failed.'
            });
        }

        var latitude = req.body.latitude;
        var longitude = req.body.longitude;

        const restInfoUrl = 'https://api-gtm.grubhub.com/restaurants/' + restId + '?hideChoiceCategories=true&version=4&orderType=standard&hideUnavailableMenuItems=true&hideMenuItems=false&showMenuItemCoupons=true&includePromos=false&queryText=' + queryText + '&location=POINT(' + lattitude + ' ' + longitude + ')';
        request({
            url: restInfoUrl,
            headers: {
                'Authorization': bearerToken
            },
            rejectUnauthorized: false
        }, function (err4, resp4) {
            if (err4) {
                return res.json({
                    status: false,
                    message: 'Failed to get restaurant data from grubhub.'
                });
            } else {
                var result = JSON.parse(resp4.body).restaurant;
                var category_list = result.menu_category_list;
                var most_popular = [];
                var foodArr = [];
                for (var i = 0; i < category_list.length; i++) {
                    var itemArr = [],
                        itemImage;
                    for (var j = 0; j < category_list[i].menu_item_list.length; j++) {
                        if (category_list[i].menu_item_list[j].media_image) itemImage = category_list[i].menu_item_list[j].media_image;
                        else itemImage = "";

                        if (category_list[i].menu_item_list[j].popular) {
                            most_popular.push({
                                item_name: category_list[i].menu_item_list[j].name,
                                item_price: category_list[i].menu_item_list[j].minimum_price_variation,
                                item_description: category_list[i].menu_item_list[j].description,
                                item_image: itemImage
                            });
                        }

                        itemArr.push({
                            item_name: category_list[i].menu_item_list[j].name,
                            item_price: category_list[i].menu_item_list[j].minimum_price_variation,
                            item_description: category_list[i].menu_item_list[j].description,
                            item_image: itemImage
                        });
                    }
                    foodArr.push({
                        menu_name: category_list[i].name,
                        menu_item_list: itemArr
                    });
                }
                return res.json({
                    name: result.name,
                    address: result.address,
                    rating: result.rating,
                    image: result.media_image,
                    cuisines: result.cuisines,
                    price_rating: result.price_rating,
                    category_list: foodArr,
                    most_popular: most_popular
                });
            }
        });
    });

    app.post('/get_category_items', function (req, res) {
        if (bearerToken == null) {
            return res.json({
                status: false,
                message: 'Authorization Failed. Try again after 10 seconds.'
            });
        }

        var queryText = req.body.queryText;
        var lattitude = req.body.lattitude;
        var longitude = req.body.longitude;

        var url = 'https://api-gtm.grubhub.com/restaurants/search?orderMethod=delivery&locationMode=DELIVERY&facetSet=umamiV2&pageSize=20&hideHateos=true&searchMetrics=true&queryText=' + queryText + '&location=POINT(' + lattitude + ' ' + longitude + ')&sortSetId=umamiV2&sponsoredSize=3&countOmittingTimes=true';
        
        request({
            url: url,
            headers: {
                'Authorization': bearerToken
            },
            rejectUnauthorized: false
        }, function (err2, resp2) {
            if (err2) {
                return res.json({
                    status: false,
                    message: 'Failed to get data from grubhub.'
                });
            } else {
                const response = JSON.parse(resp2.body);
                console.log(response);

                const searchId = response.search_id;
                const searchResult = response.search_result;
                const totalPages = searchResult.pager.total_pages;
                var restResult = searchResult.results;
                var restId = 0;
                var pageNum = 1;
                for (var i = 0; i < restResult.length; i++) {
                    restId = restResult[i].restaurant_id;
                }
                while (restId == 0 && pageNum < totalPages) {
                    pageNum++;
                    const nextPageUrl = 'https://api-gtm.grubhub.com/restaurants/search/search_listing?orderMethod=delivery&locationMode=DELIVERY&facetSet=umamiV2&pageSize=20&hideHateos=true&searchMetrics=true&queryText=' + queryText + '&location=POINT(' + lattitude + ' ' + longitude + ')&sortSetId=umamiV2&sponsoredSize=3&countOmittingTimes=true&pageNum=' + pageNum + '&searchId=' + searchId;
                    request({
                        url: nextPageUrl,
                        headers: {
                            'Authorization': bearerToken
                        },
                        rejectUnauthorized: false
                    }, function (err3, resp3) {
                        if (err3) {
                            return res.json({
                                status: false,
                                message: 'Failed to get data from grubhub.'
                            });
                        } else {
                            restResult = JSON.parse(resp3.body).results;
                            for (var i = 0; i < restResult.length; i++) {
                                restId = restResult[i].restaurant_id;
                            }
                        }
                    })
                }
                if (restId != 0) {
                    const restInfoUrl = 'https://api-gtm.grubhub.com/restaurants/' + restId + '?hideChoiceCategories=true&version=4&orderType=standard&hideUnavailableMenuItems=true&hideMenuItems=false&showMenuItemCoupons=true&includePromos=false&location=POINT(' + lattitude + ' ' + longitude + ')';
                    request({
                        url: restInfoUrl,
                        headers: {
                            'Authorization': bearerToken
                        },
                        rejectUnauthorized: false
                    }, function (err4, resp4) {
                        if (err4) {
                            return res.json({
                                status: false,
                                message: 'Failed to get restaurant data from grubhub.'
                            });
                        } else {
                            var result = JSON.parse(resp4.body).restaurant;
                            var category_list = result.menu_category_list;
                            var most_popular = [];
                            var foodArr = [];
                            for (var i = 0; i < category_list.length; i++) {
                                var itemArr = [],
                                    itemImage;
                                for (var j = 0; j < category_list[i].menu_item_list.length; j++) {
                                    if (category_list[i].menu_item_list[j].media_image) itemImage = category_list[i].menu_item_list[j].media_image;
                                    else itemImage = "";

                                    if (category_list[i].menu_item_list[j].popular) {
                                        most_popular.push({
                                            item_name: category_list[i].menu_item_list[j].name,
                                            item_price: category_list[i].menu_item_list[j].minimum_price_variation,
                                            item_description: category_list[i].menu_item_list[j].description,
                                            item_image: itemImage
                                        });
                                    }

                                    itemArr.push({
                                        item_name: category_list[i].menu_item_list[j].name,
                                        item_price: category_list[i].menu_item_list[j].minimum_price_variation,
                                        item_description: category_list[i].menu_item_list[j].description,
                                        item_image: itemImage
                                    });
                                }
                                foodArr.push({
                                    menu_name: category_list[i].name,
                                    menu_item_list: itemArr
                                });
                            }
                            return res.json({
                                name: result.name,
                                address: result.address,
                                rating: result.rating,
                                image: result.media_image,
                                cuisines: result.cuisines,
                                price_rating: result.price_rating,
                                category_list: foodArr,
                                most_popular: most_popular
                            });
                        }
                    })
                }
                // setTimeout(function () {
                //     if (restId == 0) {
                //         return res.json({
                //             status: false,
                //             message: 'Invalid restaurant name in this area. Please input valid restaurant name.'
                //         });
                //     }
                // }, 5000);
            }
        });
    });

    var server = app.listen(3200, function () {
        var host = server.address().address;
        var port = server.address().port;
        console.log("Restaurant API is running at http://%s:%s", host, port)
    });
}