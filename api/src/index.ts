import express from 'express';
import { ApolloServer } from 'apollo-server-express';
import { readFileSync } from 'fs';
import { join } from 'path';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createClient } from 'redis';
import * as cron from 'node-cron';
import { config } from 'dotenv';
import { resolvers } from './resolvers';
import { createDataSources } from './datasources';
import { logger } from './utils/logger';
import { createContext } from './context';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { authMiddleware } from './middleware/auth';

// Load environment variables
config();

const PORT = process.env.PORT || 4000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const SUBGRAPH_URL = process.env.SUBGRAPH_URL || 'http://localhost:8000/subgraphs/name/derivatives-dao';
const NODE_ENV = process.env.NODE_ENV || 'development';

async function startServer() {
  try {
    // Initialize Redis client
    const redisClient = createClient({ url: REDIS_URL });
    await redisClient.connect();
    logger.info('Connected to Redis');

    // Create Express app
    const app = express();

    // Security middleware
    app.use(helmet({
      contentSecurityPolicy: NODE_ENV === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }));
    
    app.use(cors({
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true,
    }));
    
    app.use(compression());
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true }));

    // Rate limiting
    app.use('/graphql', rateLimitMiddleware(redisClient));

    // Authentication middleware (optional)
    if (process.env.ENABLE_AUTH === 'true') {
      app.use('/graphql', authMiddleware);
    }

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
      });
    });

    // Metrics endpoint
    app.get('/metrics', async (req, res) => {
      try {
        const dataSources = createDataSources(SUBGRAPH_URL, redisClient);
        const metrics = await dataSources.subgraphAPI.getProtocolMetrics();
        res.json(metrics);
      } catch (error) {
        logger.error('Error fetching metrics:', error);
        res.status(500).json({ error: 'Failed to fetch metrics' });
      }
    });

    // Load GraphQL schema
    const typeDefs = readFileSync(join(__dirname, 'schema.graphql'), 'utf8');

    // Create Apollo Server
    const server = new ApolloServer({
      typeDefs,
      resolvers,
      dataSources: () => createDataSources(SUBGRAPH_URL, redisClient),
      context: ({ req }) => createContext(req, redisClient),
      introspection: NODE_ENV !== 'production',
      playground: NODE_ENV !== 'production',
      formatError: (error) => {
        logger.error('GraphQL Error:', error);
        
        // Don't expose internal errors in production
        if (NODE_ENV === 'production') {
          return new Error('Internal server error');
        }
        
        return error;
      },
      plugins: [
        {
          requestDidStart() {
            return {
              didResolveOperation(requestContext) {
                logger.info(`GraphQL Operation: ${requestContext.request.operationName}`);
              },
              didEncounterErrors(requestContext) {
                logger.error('GraphQL Errors:', requestContext.errors);
              },
            };
          },
        },
      ],
    });

    await server.start();
    server.applyMiddleware({ app, path: '/graphql' });

    // Start HTTP server
    const httpServer = app.listen(PORT, () => {
      logger.info(`🚀 Server ready at http://localhost:${PORT}${server.graphqlPath}`);
      logger.info(`📊 Health check at http://localhost:${PORT}/health`);
      logger.info(`📈 Metrics at http://localhost:${PORT}/metrics`);
    });

    // Setup cron jobs for data aggregation
    setupCronJobs(redisClient);

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully');
      httpServer.close(() => {
        logger.info('HTTP server closed');
      });
      await redisClient.quit();
      await server.stop();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down gracefully');
      httpServer.close(() => {
        logger.info('HTTP server closed');
      });
      await redisClient.quit();
      await server.stop();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

function setupCronJobs(redisClient: any) {
  // Cache popular queries every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      logger.info('Running cache warm-up job');
      const dataSources = createDataSources(SUBGRAPH_URL, redisClient);
      
      // Pre-cache popular queries
      await Promise.all([
        dataSources.subgraphAPI.getProtocolMetrics(),
        dataSources.subgraphAPI.getTopTraders(10),
        dataSources.subgraphAPI.getRecentTrades(50),
        dataSources.subgraphAPI.getDailyStats(30),
      ]);
      
      logger.info('Cache warm-up completed');
    } catch (error) {
      logger.error('Cache warm-up failed:', error);
    }
  });

  // Clear old cache entries every hour
  cron.schedule('0 * * * *', async () => {
    try {
      logger.info('Running cache cleanup job');
      
      // Get all cache keys
      const keys = await redisClient.keys('cache:*');
      const now = Date.now();
      
      for (const key of keys) {
        const ttl = await redisClient.ttl(key);
        if (ttl === -1) {
          // Key without expiration, set one
          await redisClient.expire(key, 3600); // 1 hour
        }
      }
      
      logger.info(`Cache cleanup completed, processed ${keys.length} keys`);
    } catch (error) {
      logger.error('Cache cleanup failed:', error);
    }
  });

  // Generate daily analytics every day at midnight
  cron.schedule('0 0 * * *', async () => {
    try {
      logger.info('Running daily analytics job');
      const dataSources = createDataSources(SUBGRAPH_URL, redisClient);
      
      // Generate and cache daily analytics
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = yesterday.toISOString().split('T')[0];
      
      const analytics = await dataSources.analyticsAPI.generateDailyAnalytics(dateStr);
      await redisClient.setEx(`analytics:daily:${dateStr}`, 86400 * 7, JSON.stringify(analytics)); // Cache for 7 days
      
      logger.info('Daily analytics job completed');
    } catch (error) {
      logger.error('Daily analytics job failed:', error);
    }
  });
}

// Start the server
startServer().catch((error) => {
  logger.error('Unhandled error during server startup:', error);
  process.exit(1);
});
