const path = require('path');
const nodeExternals = require('webpack-node-externals');

const isProduction = process.env.NODE_ENV === 'production';

console.info('Building desktop bundle in "' + (isProduction ? "production" : "development") + '" mode.');

const baseConfig = {
    target: 'electron-main',
    mode: isProduction ? 'production' : 'development',
    devtool: isProduction ? false : 'source-map',
    resolve: {
        extensions: ['.ts', '.js'],
        alias: {
            '@elevate/shared/constants': path.resolve(__dirname, '../appcore/modules/shared/constants'),
            '@elevate/shared/enums': path.resolve(__dirname, '../appcore/modules/shared/enums'),
            '@elevate/shared/data': path.resolve(__dirname, '../appcore/modules/shared/data'),
            '@elevate/shared/electron': path.resolve(__dirname, '../appcore/modules/shared/electron'),
            '@elevate/shared/sync': path.resolve(__dirname, '../appcore/modules/shared/sync'),
            '@elevate/shared/models': path.resolve(__dirname, '../appcore/modules/shared/models'),
            '@elevate/shared/resolvers': path.resolve(__dirname, '../appcore/modules/shared/resolvers'),
            '@elevate/shared/exceptions': path.resolve(__dirname, '../appcore/modules/shared/exceptions'),
            '@elevate/shared/tools': path.resolve(__dirname, '../appcore/modules/shared/tools'),
        },
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        configFile: path.resolve(__dirname, 'tsconfig.json'),
                        transpileOnly: true,
                    },
                },
            },
            {
                test: /\.json$/,
                type: 'json',
            },
        ],
    },
    externals: [
        nodeExternals({
            allowlist: [
                // Include any modules that should be bundled
                '@incremunica/query-sparql-incremental',
                '@incremunica/user-tools',
                '@thomaschampagne/sports-lib',
                // Force bundling of ESM modules to handle compatibility issues
                'retry-axios',
                'serialize-error',
            ]
        }),
        // Additional Node.js built-ins to exclude
        'electron',
        'fs',
        'os',
        'util',
        'http',
        'https',
        'url',
        'path',
        'crypto',
        'tls',
        'events',
        'tty',
        'child_process',
        'stream',
        'zlib',
        'dgram',
        'buffer',
        'worker_threads'
    ],
    node: {
        __dirname: false,
        __filename: false,
    },
    optimization: {
        minimize: isProduction,
    },
};

module.exports = [
    // Main process
    {
        ...baseConfig,
        entry: './src/main.ts',
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'desktop.bundle.js',
            libraryTarget: 'commonjs2',
        },
    },

    // Pre-loader
    {
        ...baseConfig,
        entry: './src/pre-loading/pre-loader.ts',
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'pre-loader.js',
            libraryTarget: 'umd',
            globalObject: 'this',
        },
        externals: ['electron'],
        target: 'electron-preload',
    },

    // Sports lib worker
    {
        ...baseConfig,
        target: 'node',
        entry: './src/workers/sports-lib.worker.ts',
        output: {
            path: path.resolve(__dirname, 'dist/workers'),
            filename: 'sports-lib.worker.js',
            libraryTarget: 'commonjs2',
        },
        externals: ['worker_threads', 'fs'],
    },

    // Sports lib solid worker
    {
        ...baseConfig,
        target: 'node',
        entry: './src/workers/sports-lib-solid.worker.ts',
        output: {
            path: path.resolve(__dirname, 'dist/workers'),
            filename: 'sports-lib-solid.worker.js',
            libraryTarget: 'commonjs2',
        },
        externals: ['worker_threads', 'fs'],
    },

    // Activity compute worker
    {
        ...baseConfig,
        target: 'node',
        entry: './src/workers/activity-compute.worker.ts',
        output: {
            path: path.resolve(__dirname, 'dist/workers'),
            filename: 'activity-compute.worker.js',
            libraryTarget: 'commonjs2',
        },
        externals: ['worker_threads', 'crypto'],
    },
];
