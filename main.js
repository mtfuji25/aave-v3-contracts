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

    var getBearerToken = async function () {
        try {
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox']
            });
            const page = await browser.newPage();
            await page.goto("https://www.grubhub.com/search?orderMethod=delivery&locationMode=DELIVERY&facetSet=umamiV2&pageSize=20&hideHateos=true&searchMetrics=true&latitude=38.95862960&longitude=-80.300226&facet=open_now%3Atrue&sortSetId=umamiV2&sponsoredSize=3&countOmittingTimes=true", { 
                waitUntil: "networkidle2", 
                timeout: 0
            });
            await page.setRequestInterception(true);
            page.setMaxListeners(0);
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
        } catch(error) {
            console.error(error);
        }

        setTimeout(getBearerToken, 1000 * 60);
    }

    var GetRestaurantData = function(res, restId, latitude, longitude) {
        
        const restInfoUrl = 'https://api-gtm.grubhub.com/restaurants/' + restId + '?hideChoiceCategories=true&version=4&orderType=standard&hideUnavailableMenuItems=true&hideMenuItems=false&showMenuItemCoupons=true&includePromos=false&location=POINT(' + longitude + ' ' + latitude + ')';

        request({
            url: restInfoUrl,
            headers: {
                'Authorization': bearerToken
            },
            rejectUnauthorized: false
        }, function (restDataErr, restDataResp) {
            if (restDataErr) {
                console.log('Failed to get restaurant data. Error: ' + restDataErr);
                return res.json({
                    status: false,
                    message: 'Failed to get restaurant data. Error: ' + restDataErr
                });
            } else {
                var result = JSON.parse(restDataResp.body).restaurant;
                var category_list = result.menu_category_list;
                var most_popular = [];
                var foodArr = [];
                
                for (var i = 0; i < category_list.length; i++) {
                    var itemArr = [],
                        itemImage;
                    
                    for (var j = 0; j < category_list[i].menu_item_list.length; j++) {
                        if (category_list[i].menu_item_list[j].media_image) 
                            itemImage = category_list[i].menu_item_list[j].media_image;
                        else 
                            itemImage = "";

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
    }

    getBearerToken();

    var doesModifyBody = function(request, response, next) {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        response.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, content-type');
        response.setHeader('Access-Control-Allow-Credentials', true);
        next();
    };

    app.use(doesModifyBody);

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
            console.log('Failed to get restaurant data. Error: Authorization Failed.');
            return res.json({
                status: false,
                message: 'Failed to get restaurant data. Error: Authorization Failed.'
            });
        }

        var countryName = req.body.country;
        var cityName = req.body.city;
        var restaurantName = req.body.restaurant;

        geocoder.geocode({
            address: cityName,
            country: countryName
        })
        .then(function (geoResp) {

            const latitude = geoResp[0].latitude;
            const longitude = geoResp[0].longitude;

            var url = 'https://api-gtm.grubhub.com/restaurants/search?orderMethod=delivery&locationMode=DELIVERY&facetSet=umamiV2&pageSize=20&hideHateos=true&searchMetrics=true&location=POINT(' + longitude + ' ' + latitude + ')&facet=open_now%3Atrue&sortSetId=umamiV2&sponsoredSize=3&countOmittingTimes=true';
            
            request({
                url: url,
                headers: {
                    'Authorization': bearerToken
                },
                rejectUnauthorized: false
            }, function (pageErr, pageResp) {
                if (pageErr) {
                    console.log('Failed to get restaurant data. Error: ' + pageErr);
                    return res.json({
                        status: false,
                        message: 'Failed to get restaurant data. Error: ' + pageErr
                    });
                } else {
                    const response = JSON.parse(pageResp.body);
                    const searchId = response.search_id;
                    const searchResult = response.search_result;
                    var totalPages = searchResult.pager.total_pages;
                    var restResult = searchResult.results;
                    var restId = 0;
                    var isSent = false;

                    for (var i = 0; i < restResult.length; i++) {
                        if (restaurantName.trim().toLowerCase() == restResult[i].name.toLowerCase()) {
                            restId = restResult[i].restaurant_id;
                            break;
                        }
                    }

                    var pageNum = 1;

                    if (restId != 0) {
                        console.log("Found restaurant data in page " + pageNum);
                        GetRestaurantData(res, restId, latitude, longitude);
                    } else {
                        pageNum = 2;

                        while (restId == 0 && pageNum <= totalPages) {
                            
                            const nextPageUrl = 'https://api-gtm.grubhub.com/restaurants/search/search_listing?orderMethod=delivery&locationMode=DELIVERY&facetSet=umamiV2&pageSize=20&hideHateos=true&searchMetrics=true&location=POINT(' + longitude + ' ' + latitude + ')&facet=open_now%3Atrue&sortSetId=umamiV2&sponsoredSize=3&countOmittingTimes=true&pageNum=' + pageNum + '&searchId=' + searchId;
                            
                            request({
                                url: nextPageUrl,
                                headers: {
                                    'Authorization': bearerToken
                                },
                                rejectUnauthorized: false
                            }, function (nextPageErr, nextPageResp) {

                                if (nextPageErr) {
                                    console.log('Failed to get restaurant data. Error: ' + nextPageErr);
                                    return res.json({
                                        status: false,
                                        message: 'Failed to get restaurant data. Error: ' + nextPageErr
                                    });
                                } else {
                                    restResult = JSON.parse(nextPageResp.body).results;

                                    for (var i = 0; i < restResult.length; i++) {
                                        if (restaurantName.trim().toLowerCase() == restResult[i].name.toLowerCase()) {
                                            restId = restResult[i].restaurant_id;
                                            break;
                                        }
                                    }

                                    if (restId != 0 && isSent == false) {
                                        isSent = true;
                                        console.log("Found restaurant data in page " + pageNum);
                                        GetRestaurantData(res, restId, latitude, longitude);
                                        return false;
                                    }
                                }
                            });

                            console.log("PageNum: " + pageNum);
                            pageNum ++;
                        }

                        setTimeout(function() {
                            if (restId == 0) {
                                console.log('Failed to get restaurant data. Error: Result not found.');
                                return res.json({
                                    status: false,
                                    message: 'Failed to get restaurant data. Error: Result not found.'
                                });
                            }
                        }, 10 * 1000);
                        
                    }
                }
            });
        })
        .catch(function (geoErr) {
            console.log('Failed to get restaurant data. Error: Geo Location Invalid.');
            return res.json({
                status: false,
                message: 'Failed to get restaurant data. Error: Geo Location Invalid.'
            });
        });
    });

    app.post('/get_category_items', function (req, res) {
        
        if (bearerToken == null) {
            console.log('Failed to get restaurant data. Error: Authorization Failed.');
            return res.json({
                status: false,
                message: 'Failed to get restaurant data. Error: Authorization Failed.'
            });
        }

        var latitude = req.body.latitude;
        var longitude = req.body.longitude;
        var category = req.body.category;

        var url = 'https://api-gtm.grubhub.com/restaurants/search?orderMethod=delivery&locationMode=DELIVERY&facetSet=umamiV2&pageSize=20&hideHateos=true&searchMetrics=true&queryText=' + category + '&location=POINT(' + longitude + ' ' + latitude + ')&facet=open_now%3Atrue&sortSetId=umamiV2&sponsoredSize=3&countOmittingTimes=true';
            
        request({
            url: url,
            headers: {
                'Authorization': bearerToken
            },
            rejectUnauthorized: false
        }, function (pageErr, pageResp) {
            if (pageErr) {
                console.log('Failed to get restaurant data. Error: ' + pageErr);
                return res.json({
                    status: false,
                    message: 'Failed to get restaurant data. Error: ' + pageErr
                });
            } else {
                const response = JSON.parse(pageResp.body);
                const searchResult = response.search_result;
                var restResult = searchResult.results;

                console.log("Total results: "+ restResult.length);

                var categoryData = [];
                
                if (restResult.length == 0) {
                    console.log("Found 0 category items.");
                    return res.json(categoryData);
                } else {
                    for (var index = 0; index < restResult.length; index++) {
                        
                        const restInfoUrl = 'https://api-gtm.grubhub.com/restaurants/' + restResult[index].restaurant_id + '?hideChoiceCategories=true&version=4&orderType=standard&hideUnavailableMenuItems=true&hideMenuItems=false&showMenuItemCoupons=true&includePromos=false&location=POINT(' + longitude + ' ' + latitude + ')';
                        
                        request({
                            url: restInfoUrl,
                            headers: {
                                'Authorization': bearerToken
                            },
                            rejectUnauthorized: false
                        }, function (restDataErr, restDataResp) {
                            if (restDataErr) {
                                console.log('Failed to get restaurant data. Error: ' + restDataErr);
                                return res.json({
                                    status: false,
                                    message: 'Failed to get restaurant data. Error: ' + restDataErr
                                });
                            } else {
                                var result = JSON.parse(restDataResp.body).restaurant;
                                var category_list = result.menu_category_list;
                                var most_popular = [];
                                var foodArr = [];
                                
                                for (var i = 0; i < category_list.length; i++) {
                                    var itemArr = [],
                                        itemImage;
                                    
                                    for (var j = 0; j < category_list[i].menu_item_list.length; j++) {
                                        if (category_list[i].menu_item_list[j].media_image) 
                                            itemImage = category_list[i].menu_item_list[j].media_image;
                                        else 
                                            itemImage = "";

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
                                categoryData.push({
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
                    }

                    setTimeout(function() {
                        return res.json(categoryData);
                    }, 5 * 1000);
                }
            }
        });
    });

    var server = app.listen(3200, function () {

        var host = server.address().address;
        var port = server.address().port;

        console.log("Restaurant API is running at http://%s:%s", host, port)
    });
}