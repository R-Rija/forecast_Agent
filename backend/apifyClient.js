import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';

dotenv.config();

// Initialize the ApifyClient with API token
const client = new ApifyClient({
    token: process.env.APIFY_API_TOKEN,
});

/**
 * YouTube Scraper
 * Actor ID: streamers/youtube-scraper
 */
export async function scrapeYouTube(inputOptions) {
    const run = await client.actor("streamers/youtube-scraper").call(inputOptions);
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    return items;
}

/**
 * Instagram Scraper
 * Actor ID: apify/instagram-scraper
 */
export async function scrapeInstagram(inputOptions) {
    const run = await client.actor("apify/instagram-scraper").call(inputOptions);
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    return items;
}

/**
 * Amazon Product Scraper
 * Actor ID: junglee/Amazon-crawler
 */
export async function scrapeAmazon(inputOptions) {
    const run = await client.actor("junglee/Amazon-crawler").call(inputOptions);
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    return items;
}

/**
 * Shopee Scraper - All in one
 * Actor ID: xtracto/shopee-scraper
 */
export async function scrapeShopee(inputOptions) {
    const run = await client.actor("xtracto/shopee-scraper").call(inputOptions);
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    return items;
}

/**
 * Alibaba Scraper
 * Actor ID: zen-studio/alibaba-scraper
 */
export async function scrapeAlibaba(inputOptions) {
    const run = await client.actor("zen-studio/alibaba-scraper").call(inputOptions);
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    return items;
}

export default client;
