module.exports = {
  resolve: {
    fallback: {
      url: require.resolve('url/'),
      buffer: require.resolve('buffer/'),
      process: require.resolve('process/browser')
    }
  }
};
