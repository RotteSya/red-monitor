// === X List member GraphQL source (popup context) ===
//
// Mirrors the x-xillot ListMembers endpoint shape. Popup cannot safely write
// page settings from window.postMessage; instead it writes an extension-owned
// request to chrome.storage.local, and the x.com content bridge performs the
// authenticated same-origin fetch.

(function () {
  const REQUEST_KEY = 'xvm_list_member_fetch_request_v1';
  const RESPONSE_KEY = 'xvm_list_member_fetch_response_v1';
  const QUERY_ID = {
    ListMembers: 'l90-8FD7I3dxXqJfyxSEeA',
    ListLatestTweetsTimeline: '7UuJsFvnWuZo0HmxrzU42Q',
  };
  const LIMITS = Object.freeze({
    maxLists: 5,
    maxMembersPerList: 5000,
    maxMembersTotal: 10000,
  });
  const PAGE_SIZE = 100;
  const REQUEST_TIMEOUT_MS = 15000;

  const LIST_FEATURES = Object.freeze({
    rweb_video_screen_enabled: false,
    rweb_cashtags_enabled: true,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: false,
    rweb_tipjar_consumption_enabled: false,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: false,
    responsive_web_grok_analyze_post_followups_enabled: true,
    rweb_cashtags_composer_attachment_enabled: true,
    responsive_web_jetfuel_frame: true,
    responsive_web_grok_share_attachment_enabled: true,
    responsive_web_grok_annotations_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    rweb_conversational_replies_downvote_enabled: false,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    content_disclosure_indicator_enabled: true,
    content_disclosure_ai_generated_indicator_enabled: true,
    responsive_web_grok_show_grok_translated_post: true,
    responsive_web_grok_analysis_button_from_backend: true,
    post_ctas_fetch_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: false,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_grok_imagine_annotation_enabled: true,
    responsive_web_grok_community_note_auto_translation_is_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  });

  function storageSet(obj) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(obj, () => {
          const err = chrome.runtime?.lastError;
          if (err) reject(new Error(err.message));
          else resolve();
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function storageRemove(keys) {
    try { chrome.storage.local.remove(keys); } catch (_) {}
  }

  function randomId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function extractListId(input) {
    const v = String(input || '').trim();
    if (!v) return '';
    if (/^\d+$/.test(v)) return v;
    const m = v.match(/(?:x\.com|twitter\.com)\/i\/lists\/(\d+)/i)
      || v.match(/\/i\/lists\/(\d+)/i)
      || v.match(/\/lists\/(\d+)(?:[/?#]|$)/i);
    return m?.[1] || '';
  }

  function listUrl(listId) {
    return `https://x.com/i/lists/${listId}`;
  }

  function buildListMembersUrl({ listId, cursor }) {
    const variables = { listId: String(listId), count: PAGE_SIZE };
    if (cursor) variables.cursor = cursor;
    return `https://x.com/i/api/graphql/${QUERY_ID.ListMembers}/ListMembers?` + new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(LIST_FEATURES),
    }).toString();
  }

  function timelineInstructions(data) {
    return data?.data?.list?.members_timeline?.timeline?.instructions
      || data?.data?.list_members_timeline?.timeline?.instructions
      || null;
  }

  function walkObjects(value, visit) {
    if (!value || typeof value !== 'object') return;
    visit(value);
    if (Array.isArray(value)) {
      for (const item of value) walkObjects(item, visit);
      return;
    }
    for (const item of Object.values(value)) walkObjects(item, visit);
  }

  function normalizeScreenName(v) {
    const s = String(v || '').trim().replace(/^@+/, '').toLowerCase();
    return /^[a-z0-9_]{1,15}$/.test(s) ? s : '';
  }

  function flattenUserResult(result) {
    const user = result?.user_results?.result || result?.result || result;
    if (!user || typeof user !== 'object') return null;
    const core = user.core || {};
    const legacy = user.legacy || {};
    const userId = String(user.rest_id || legacy.id_str || '').trim();
    const screenName = normalizeScreenName(core.screen_name || legacy.screen_name);
    if (!userId && !screenName) return null;
    return {
      userId,
      screenName,
      name: String(core.name || legacy.name || screenName || userId).trim(),
      profileImageUrl: String(user.avatar?.image_url || legacy.profile_image_url_https || '').trim(),
    };
  }

  function parseListMembersResponse(data) {
    const instructions = timelineInstructions(data);
    const members = [];
    const seen = new Set();
    let cursor = '';
    walkObjects(instructions, (obj) => {
      const user = obj?.user_results ? flattenUserResult(obj) : null;
      if (user) {
        const key = user.userId || user.screenName;
        if (!seen.has(key)) {
          seen.add(key);
          members.push(user);
        }
      }
      const cur = obj?.cursorType || obj?.cursor_type || obj?.content?.cursorType;
      const val = obj?.value || obj?.cursor?.value || obj?.content?.value || obj?.content?.cursor?.value;
      if (String(cur || '').toLowerCase() === 'bottom' && typeof val === 'string' && val) {
        cursor = val;
      }
    });
    return { members, cursor };
  }

  function requestGraphQL(url, timeoutMs = REQUEST_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const requestId = randomId();
      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { chrome.storage.onChanged.removeListener(onChanged); } catch (_) {}
        storageRemove([REQUEST_KEY, RESPONSE_KEY]);
      };
      const onChanged = (changes, area) => {
        if (area !== 'local') return;
        const response = changes[RESPONSE_KEY]?.newValue;
        if (!response || response.requestId !== requestId) return;
        cleanup();
        if (!response.ok) {
          reject(new Error(response.error || `GraphQL fetch failed (${response.status || 'unknown'})`));
          return;
        }
        resolve(response);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Open an X.com tab and reload it, then retry fetching List members.'));
      }, timeoutMs);

      try { chrome.storage.onChanged.addListener(onChanged); } catch (e) {
        clearTimeout(timer);
        reject(e);
        return;
      }
      storageSet({
        [REQUEST_KEY]: {
          requestId,
          op: 'ListMembers',
          url,
          createdAt: Date.now(),
        },
      }).catch((e) => {
        cleanup();
        reject(e);
      });
    });
  }

  async function fetchListMembers(input, options = {}) {
    const listId = extractListId(input?.listId || input?.url || input);
    if (!listId) throw new Error('Enter a numeric X List URL or listId.');
    const maxPages = Math.max(1, Math.min(Number(options.maxPages) || 50, 80));
    const maxMembers = Math.max(1, Math.min(Number(options.maxMembers) || LIMITS.maxMembersPerList, LIMITS.maxMembersPerList));
    const members = [];
    const seen = new Set();
    let cursor = '';
    let pages = 0;
    let rateLimit = null;

    do {
      const url = buildListMembersUrl({ listId, cursor });
      const response = await requestGraphQL(url, options.timeoutMs || REQUEST_TIMEOUT_MS);
      rateLimit = response.rateLimit || response.rate_limit || rateLimit;
      const page = parseListMembersResponse(response.data);
      pages += 1;
      for (const m of page.members) {
        const key = m.userId || m.screenName;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        members.push(m);
        if (members.length >= maxMembers) break;
      }
      cursor = page.cursor || '';
      if (members.length >= maxMembers) break;
    } while (cursor && pages < maxPages);

    if (!members.length) throw new Error('List members were not returned. Open the List page on X and retry.');
    return {
      listId,
      url: input?.url || listUrl(listId),
      name: input?.name || `List ${listId}`,
      members,
      fetchedAt: Date.now(),
      source: 'graphql',
      pages,
      rateLimit,
    };
  }

  window.__xvmListMemberSource = {
    REQUEST_KEY,
    RESPONSE_KEY,
    QUERY_ID,
    LIST_FEATURES,
    LIMITS,
    extractListId,
    buildListMembersUrl,
    parseListMembersResponse,
    requestGraphQL,
    fetchListMembers,
  };
})();
