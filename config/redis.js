const Redis = require("ioredis");
require("dotenv").config();

class RedisConnection {
  constructor() {
    this.redisConfig = {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD,
      connectTimeout: 10000, // 10 seconds
      retryStrategy: (times) => {
        // Exponential back-off strategy
        return Math.min(times * 50, 2000);
      },
    };

    this.publisher = this.createPublisherClient();
    this.subscriber = this.createSubscriberClient();

    this.setupSubscriberHandlers();
  }

  createPublisherClient() {
    const client = new Redis(this.redisConfig);
    client.on("error", (err) => {
      console.error("Redis Publisher Error:", err);
    });
    return client;
  }

  createSubscriberClient() {
    const client = new Redis(this.redisConfig);
    client.on("error", (err) => {
      console.error("Redis Subscriber Error:", err);
    });
    return client;
  }

  setupSubscriberHandlers() {
    this.subscriber.on("connect", () => {
      console.log("Redis subscriber connected");
    });

    this.subscriber.on("error", (err) => {
      console.error("Redis Subscriber Error:", err);
    });
  }

  // Method to publish a message
  publish(channel, message) {
    return this.publisher.publish(channel, message);
  }

  // Method to subscribe to a channel
  subscribe(channel, callback) {
    // If a callback is provided, use it
    if (callback) {
      this.subscriber.subscribe(channel);
      this.subscriber.on("message", (subscribeChannel, message) => {
        if (subscribeChannel === channel) {
          callback(message);
        }
      });
    }
    return this.subscriber.subscribe(channel);
  }

  // Method to unsubscribe from a channel
  unsubscribe(channel) {
    return this.subscriber.unsubscribe(channel);
  }

  // Close all connections
  quit() {
    this.publisher.quit();
    this.subscriber.quit();
  }
}

module.exports = new RedisConnection();
