'use strict';
(async () => {
const // 参照: [Firefox のアドオン(content_scripts)でXMLHttpRequestやfetchを使う場合の注意 - 風柳メモ](https://memo.furyutei.com/entry/20180718/1531914142)
    fetch = (typeof content != 'undefined' && typeof content.fetch == 'function') ? content.fetch  : window.fetch;

const
    api_script_selector = 'script[src*="/responsive-web/client-web/api."]',
    html = await fetch(location.href).then((response) => {
        if (! response.ok) {
            throw new Error(`${response.status} ${response.statusText}`);
        }
        return response.text();
    }).catch((error) => console.error(error));
if (! html) {
    return;
}

const
    api_script_key = html.match(/"?api"?\s*:\s*"([^"]+)"/)[1],
    api_script_suffix = html.match(/\s*\+\s*"([^".]+\.js)"/)[1];
console.debug(`api_script_key: ${api_script_key}, api_script_suffix: ${api_script_suffix}`);
if ((! api_script_key) || (! api_script_suffix)) {
    // 旧TweetDeck(Cookieのtweetdeck_version=legacy)だと存在しない
    return;
}

const
    api_script = `https://abs.twimg.com/responsive-web/client-web/api.${api_script_key}${api_script_suffix}`;
console.debug(`api_script: ${api_script}`);

const
    api_js_text = await fetch(api_script).then((response) => {
        if (! response.ok) {
            throw new Error(`${response.status} ${response.statusText}`);
        }
        return response.text();
    }).catch((error) => console.error(error));
if (! api_js_text) {
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

window.tweet_api = {
    call_graphql_api,
};
})();
