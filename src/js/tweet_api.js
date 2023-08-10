'use strict';
(async (chrome) => {
const
    USE_BACKGROUND_FETCH = false;

const // 参照: [Firefox のアドオン(content_scripts)でXMLHttpRequestやfetchを使う場合の注意 - 風柳メモ](https://memo.furyutei.com/entry/20180718/1531914142)
    fetch = (typeof content != 'undefined' && typeof content.fetch == 'function') ? content.fetch  : window.fetch;

const
    async_wait = (wait_msec) => {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(wait_msec);
            }, wait_msec);
        });
    },
    
    wait_background_ready = (() => {
        // [メモ] backgroundの処理を(async() => {…})(); に変更(2023/08/07)
        // →受信準備ができていない場合にエラーになるため、準備できるまで待つ
        let
            is_ready = false;
        
        return async () => {
            if (is_ready) {
                return;
            }
            for (;;) {
                try {
                    const
                        response = await chrome.runtime.sendMessage({
                            type : 'HEALTH_CHECK_REQUEST',
                        });
                    if (response?.is_ready) {
                        console.debug('background is ready', response);
                        is_ready = true;
                        break;
                    }
                }
                catch (error) {
                    console.warn('sendMessage() error', error);
                }
                await async_wait(10);
            }
        };
    })(),
    
    content_fetch_text = async (url, options) => {
        try {
            const
                response = await fetch(url, options);
            if (response.error) {
                throw new Error(response.error);
            }
            const
                response_text = await response.text();
            return response_text;
        }
        catch (error) {
            throw new Error(error);
        }
    },
    
    background_fetch_text = async (url, options) => {
        const
            response = await chrome.runtime.sendMessage({
                type : 'FETCH_TEXT_REQUEST',
                url,
                options,
            });
        if (response.error) {
            throw new Error(response.error);
        }
        return response.text;
    },
    
    fetch_text = USE_BACKGROUND_FETCH ? background_fetch_text : content_fetch_text;

if (USE_BACKGROUND_FETCH) {
    await wait_background_ready();
}

const
    tweet_api = {
        call_graphql_api : null,
    };

let
    html;
try {
    html = await fetch_text(location.href, {
        //mode: 'cors',
    });
}
catch (error) {
    console.error(error);
    window.tweet_api = Object.assign(tweet_api, {
        register_error: `fetch(${location.href}) error`,
    });
    return;
}

const
    api_url_base = (html.match(new RegExp('"(https://abs\.twimg\.com/[^/]+/client-web/)"')) ?? [])[1],
    api_script_key = (html.match(/"?api"?\s*:\s*"([^"]+)"/) ?? [])[1],
    api_script_suffix = (html.match(/\s*\+\s*"([^".]+\.js)"/) ?? [])[1];
console.debug(`api_url_base: ${api_url_base}, api_script_key: ${api_script_key}, api_script_suffix: ${api_script_suffix}`);
if ((! api_url_base) || (! api_script_key) || (! api_script_suffix)) {
    // 旧TweetDeck(Cookieのtweetdeck_version=legacy)だと存在しない
    window.tweet_api = Object.assign(tweet_api, {
        register_error: 'api_script_key is not found',
    });
    return;
}

const
    api_script = `${api_url_base}api.${api_script_key}${api_script_suffix}`;
console.debug(`api_script: ${api_script}`);

let
    api_js_text;
try {
    api_js_text = await fetch_text(api_script, {
        //mode: 'cors',
    });
}
catch (error) {
    console.error(error);
    window.tweet_api = Object.assign(tweet_api, {
        register_error: `fetch(${api_script}) error`,
    });
    return;
}

const
    operationName_map = [... api_js_text.matchAll(/queryId\s*:\s*"([^"]+)".*?operationName\s*:\s*"([^"]+)"/g)]
        .reduce((name_map, [_, queryId, operationName]) => {
            name_map[operationName] = queryId;
            return name_map;
        } , Object.create(null)),
    
    get_graphql_api_endpoint = (operationName) => {
        const
            queryId = operationName_map[operationName];
        return `https://twitter.com/i/api/graphql/${queryId}/${operationName}`;
    },
    
    auth_bearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
    
    default_query_params = {
        features : JSON.stringify({
            'rweb_lists_timeline_redesign_enabled' : true,
            'responsive_web_graphql_exclude_directive_enabled' : true,
            'verified_phone_label_enabled' : false,
            'creator_subscriptions_tweet_preview_api_enabled' : true,
            'responsive_web_graphql_timeline_navigation_enabled' : true,
            'responsive_web_graphql_skip_user_profile_image_extensions_enabled' : false,
            'tweetypie_unmention_optimization_enabled' : true,
            'responsive_web_edit_tweet_api_enabled' : true,
            'graphql_is_translatable_rweb_tweet_is_translatable_enabled' : true,
            'view_counts_everywhere_api_enabled' : true,
            'longform_notetweets_consumption_enabled' : true,
            'responsive_web_twitter_article_tweet_consumption_enabled' : false,
            'tweet_awards_web_tipping_enabled' : false,
            'freedom_of_speech_not_reach_fetch_enabled' : true,
            'standardized_nudges_misinfo' : true,
            'tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled' : true,
            'longform_notetweets_rich_text_read_enabled' : true,
            'longform_notetweets_inline_media_enabled' : true,
            'responsive_web_media_download_video_enabled' : false,
            'responsive_web_enhance_cards_enabled' : false,
        }),
        fieldToggles : JSON.stringify({
            'withArticleRichContentState' : false
        }),
    },
    
    call_graphql_api = async (parameters) => {
        const
            api_endpoint = get_graphql_api_endpoint(parameters.operationName),
            csrf_token = document.cookie.match(/ct0=(.*?)(?:;|$)/)[1],
            client_language = parameters?.client_language ?? 'en',
            query_params_string = new URLSearchParams(Object.assign({},
                default_query_params,
                parameters?.query_params ?? {}
            )).toString();
        return await fetch(`${api_endpoint}?${query_params_string}`, {
            headers : {
                'Content-Type' : 'application/json',
                'Authorization' : `Bearer ${auth_bearer}`,
                'X-Csrf-Token' : `${csrf_token}`,
                'X-Twitter-Active-User' : 'yes',
                'X-Twitter-Auth-Type' : 'OAuth2Session',
                'X-Twitter-Client-Language' : `${client_language}`,
                //'X-Client-Transaction-Id' : '@@@', // @@@ X-Client-Transaction-Id (94文字?)の求め方が不明
            }
        });
    };

console.debug('operationName_map:', operationName_map);

window.tweet_api = Object.assign(tweet_api, {
    call_graphql_api,
});

})(((typeof browser != 'undefined') && browser.runtime) ? browser : chrome);
