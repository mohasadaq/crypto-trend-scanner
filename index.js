class TradingService {
  constructor() {
    this.BINANCE_API = "https://api.binance.com/api/v3";
    this.COINMARKETCAP_API = "https://api.coinmarketcap.com/data-api/v3";
    this.CORS_PROXY = "https://corsproxy.io/?"; // You can use any CORS proxy service
    this.VOLUME_THRESHOLD = 1000000;
    this.SUPPORT_RESISTANCE_LOOKBACK = 100;
  }

  async fetchWithCORS(url, options = {}) {
    try {
      // Use CORS proxy for the request
      const proxyUrl = `${this.CORS_PROXY}${encodeURIComponent(url)}`;

      const response = await fetch(proxyUrl, {
        ...options,
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          ...options.headers,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          Accept: "application/json",
          Origin: window.location.origin,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error("Error fetching data:", error);
      throw error;
    }
  }

  async fetchBinanceData(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error("Error fetching Binance data:", error);
      throw error;
    }
  }

  async getTopCoins(limit) {
    try {
      const response = await this.fetchBinanceData(
        `${this.BINANCE_API}/ticker/24hr`
      );

      if (!Array.isArray(response)) {
        throw new Error("Invalid response format from Binance API");
      }

      // Filter for USDT pairs and sort by volume
      const usdtPairs = response
        .filter((ticker) => ticker.symbol.endsWith("USDT"))
        .sort((a, b) => parseFloat(b.volume) - parseFloat(a.volume))
        .slice(0, limit)
        .map((ticker) => ({
          symbol: ticker.symbol.replace("USDT", ""),
          name: ticker.symbol.replace("USDT", ""),
          price: parseFloat(ticker.lastPrice),
          volume: parseFloat(ticker.volume),
          change24h: parseFloat(ticker.priceChangePercent),
        }));

      return usdtPairs;
    } catch (error) {
      console.error("Error fetching top coins:", error);
      throw error;
    }
  }

  async getHistoricalData(symbol, interval) {
    try {
      // Format symbol for Binance API (e.g., "BTCUSDT")
      const formattedSymbol = symbol.endsWith("USDT")
        ? symbol
        : `${symbol}USDT`;

      // Ensure limit is a valid number between 1 and 1000
      const limit = 100; // Fixed limit for historical data

      const response = await this.fetchBinanceData(
        `${this.BINANCE_API}/klines?symbol=${formattedSymbol}&interval=${interval}&limit=${limit}`
      );

      if (!Array.isArray(response)) {
        throw new Error("Invalid response format from Binance API");
      }

      return response.map((candle) => ({
        timestamp: candle[0],
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[5]),
      }));
    } catch (error) {
      console.error("Error fetching historical data:", error);
      throw error;
    }
  }

  async analyzeTopCoins(limit = 10, search, timeframe = "4h") {
    try {
      // Get top coins from Binance
      const topCoins = await this.getTopCoins(search ? 1000 : limit);

      // Filter coins by search term if provided
      const filteredCoins = search
        ? topCoins.filter(
            (coin) =>
              coin.symbol.toLowerCase().includes(search.toLowerCase()) ||
              coin.name.toLowerCase().includes(search.toLowerCase())
          )
        : topCoins;

      console.log(`Analyzing ${filteredCoins.length} coins`);

      const analysisResults = [];
      for (const coin of filteredCoins) {
        try {
          // Format symbol for Binance (e.g., "BTCUSDT")
          const symbol = `${coin.symbol}USDT`;
          console.log(`Analyzing ${symbol} (${coin.name})`);

          // Get current price and 24h change from Binance
          const ticker = await this.getTicker(symbol);

          // Analyze the market with specified timeframe
          const analysis = await this.analyzePair(symbol, timeframe);

          // Combine all data into a single object
          const coinData = {
            symbol: coin.symbol,
            name: coin.name,
            price: ticker.price,
            change24h: ticker.priceChangePercent,
            volume: ticker.volume,
            timeframe,
            trend: this.determineTrend(
              await this.getHistoricalData(symbol, timeframe)
            ),
            ...analysis,
          };

          analysisResults.push(coinData);
        } catch (error) {
          console.error(`Error analyzing ${coin.symbol}:`, error.message);
          continue;
        }
      }

      return analysisResults;
    } catch (error) {
      console.error("Error in analyzeTopCoins:", error.message);
      return []; // Return empty array instead of throwing error
    }
  }

  analyzeVolume(candles) {
    const recentVolume = candles[candles.length - 1].volume;
    const averageVolume =
      candles.reduce((sum, candle) => sum + candle.volume, 0) / candles.length;

    const volumeTrend = this.calculateVolumeTrend(candles);

    return {
      isHighVolume: recentVolume > averageVolume * this.VOLUME_THRESHOLD,
      volumeTrend,
    };
  }

  calculateVolumeTrend(candles) {
    const recentVolumes = candles.slice(-5).map((c) => c.volume);
    const trend = recentVolumes.reduce((acc, vol, i) => {
      if (i === 0) return 0;
      return acc + (vol > recentVolumes[i - 1] ? 1 : -1);
    }, 0);

    if (trend > 2) return "increasing";
    if (trend < -2) return "decreasing";
    return "stable";
  }

  findSupportResistance(candles) {
    const levels = [];
    const lookback = Math.min(this.SUPPORT_RESISTANCE_LOOKBACK, candles.length);

    for (let i = lookback; i < candles.length; i++) {
      const window = candles.slice(i - lookback, i);
      const highs = window.map((c) => c.high);
      const lows = window.map((c) => c.low);

      // Find local maxima and minima
      for (let j = 1; j < window.length - 1; j++) {
        if (highs[j] > highs[j - 1] && highs[j] > highs[j + 1]) {
          levels.push({
            price: highs[j],
            strength: this.calculateLevelStrength(highs[j], window),
            type: "resistance",
          });
        }
        if (lows[j] < lows[j - 1] && lows[j] < lows[j + 1]) {
          levels.push({
            price: lows[j],
            strength: this.calculateLevelStrength(lows[j], window),
            type: "support",
          });
        }
      }
    }

    return this.mergeNearbyLevels(levels);
  }

  calculateLevelStrength(price, candles) {
    let touches = 0;
    const tolerance = price * 0.001; // 0.1% tolerance

    for (const candle of candles) {
      if (
        Math.abs(candle.high - price) <= tolerance ||
        Math.abs(candle.low - price) <= tolerance
      ) {
        touches++;
      }
    }

    return touches / candles.length;
  }

  mergeNearbyLevels(levels) {
    const merged = [];
    const tolerance = 0.001; // 0.1% price difference

    for (const level of levels) {
      const existing = merged.find(
        (l) =>
          Math.abs(l.price - level.price) / l.price <= tolerance &&
          l.type === level.type
      );

      if (existing) {
        existing.strength = Math.max(existing.strength, level.strength);
      } else {
        merged.push(level);
      }
    }

    return merged.sort((a, b) => b.strength - a.strength);
  }

  determineTrend(candles) {
    const sma20 = this.calculateSMA(candles, 20);
    const sma50 = this.calculateSMA(candles, 50);

    const recentPrice = candles[candles.length - 1].close;
    const priceAboveSMA20 = recentPrice > sma20;
    const sma20AboveSMA50 = sma20 > sma50;

    if (priceAboveSMA20 && sma20AboveSMA50) return "up";
    if (!priceAboveSMA20 && !sma20AboveSMA50) return "down";
    return "sideways";
  }

  calculateSMA(candles, period) {
    const closes = candles.slice(-period).map((c) => c.close);
    return closes.reduce((sum, price) => sum + price, 0) / period;
  }

  shouldTrade(candles, volumeAnalysis, supportResistance, trend) {
    const currentPrice = candles[candles.length - 1].close;
    const nearestSupport = supportResistance
      .filter((l) => l.type === "support")
      .sort(
        (a, b) =>
          Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice)
      )[0];

    const nearestResistance = supportResistance
      .filter((l) => l.type === "resistance")
      .sort(
        (a, b) =>
          Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice)
      )[0];

    // Trading conditions
    const isNearSupport =
      nearestSupport &&
      Math.abs(currentPrice - nearestSupport.price) / currentPrice <= 0.01; // Within 1% of support
    const isNearResistance =
      nearestResistance &&
      Math.abs(currentPrice - nearestResistance.price) / currentPrice <= 0.01; // Within 1% of resistance

    return (
      volumeAnalysis.isHighVolume && // High volume
      volumeAnalysis.volumeTrend === "increasing" && // Increasing volume
      ((trend === "up" && !isNearResistance) || // Uptrend and not at resistance
        (trend === "down" && isNearSupport) || // Downtrend but at support
        (trend === "sideways" && (isNearSupport || isNearResistance))) // Sideways and at key level
    );
  }

  async analyzePair(symbol, interval = "4h") {
    try {
      const candles = await this.getHistoricalData(symbol, interval);
      const currentPrice = candles[candles.length - 1].close;

      // Calculate various technical indicators
      const sma200 = this.calculateSMA(candles, 200);
      const sma50 = this.calculateSMA(candles, 50);
      const sma20 = this.calculateSMA(candles, 20);
      const rsi = this.calculateRSI(candles);
      const stochRSI = this.calculateStochRSI(candles);
      const macd = this.calculateMACD(candles);

      // Calculate support and resistance levels
      const supportResistance = this.findSupportResistance(candles);
      const supportLevels = supportResistance
        .filter((level) => level.type === "support")
        .map((level) => level.price);
      const resistanceLevels = supportResistance
        .filter((level) => level.type === "resistance")
        .map((level) => level.price);

      const levels = {
        support:
          supportLevels.length > 0
            ? Math.min(...supportLevels)
            : currentPrice * 0.95, // Default to 5% below current price if no support found
        resistance:
          resistanceLevels.length > 0
            ? Math.max(...resistanceLevels)
            : currentPrice * 1.05, // Default to 5% above current price if no resistance found
      };

      const buySignals = [];
      const sellSignals = [];

      // Price relative to support/resistance
      const supportDistance =
        ((currentPrice - levels.support) / levels.support) * 100;
      const resistanceDistance =
        ((levels.resistance - currentPrice) / currentPrice) * 100;

      // Buy signals
      if (supportDistance < 2) {
        // Near support
        buySignals.push("Near Support");
      }
      if (rsi < 30) {
        buySignals.push("RSI Oversold");
      }
      if (stochRSI < 0.2) {
        buySignals.push("StochRSI Oversold");
      }
      if (macd.histogram > 0 && macd.histogram > macd.signal) {
        buySignals.push("MACD Bullish");
      }
      if (currentPrice > sma20 && sma20 > sma50 && sma50 > sma200) {
        buySignals.push("Golden Cross");
      }

      // Sell signals
      if (resistanceDistance < 2) {
        // Near resistance
        sellSignals.push("Near Resistance");
      }
      if (rsi > 70) {
        sellSignals.push("RSI Overbought");
      }
      if (stochRSI > 0.8) {
        sellSignals.push("StochRSI Overbought");
      }
      if (macd.histogram < 0 && macd.histogram < macd.signal) {
        sellSignals.push("MACD Bearish");
      }
      if (currentPrice < sma20 && sma20 < sma50 && sma50 < sma200) {
        sellSignals.push("Death Cross");
      }

      // Determine overall trend
      const trend = this.determineTrend(candles);

      // Calculate signal strength
      const buyStrength = buySignals.length;
      const sellStrength = sellSignals.length;

      // Make final decision
      let decision = "HOLD";
      let confidence = 0;

      if (buyStrength > sellStrength && trend === "up") {
        decision = "BUY";
        confidence = (buyStrength / (buyStrength + sellStrength)) * 100;
      } else if (sellStrength > buyStrength && trend === "down") {
        decision = "SELL";
        confidence = (sellStrength / (buyStrength + sellStrength)) * 100;
      }

      return {
        buySignals,
        sellSignals,
        decision,
        confidence: Math.round(confidence),
        indicators: {
          sma200,
          sma50,
          sma20,
          rsi,
          stochRSI,
          macd: {
            value: macd.value,
            signal: macd.signal,
            histogram: macd.histogram,
          },
        },
        levels,
        trend,
        currentPrice,
      };
    } catch (error) {
      console.error(`Error analyzing pair ${symbol}:`, error.message);
      return {
        buySignals: [],
        sellSignals: [],
        decision: "HOLD",
        confidence: 0,
        indicators: {
          sma200: 0,
          sma50: 0,
          sma20: 0,
          rsi: 0,
          stochRSI: 0,
          macd: {
            value: 0,
            signal: 0,
            histogram: 0,
          },
        },
        levels: {
          support: 0,
          resistance: 0,
        },
        trend: "NEUTRAL",
        currentPrice: 0,
      };
    }
  }

  calculateStochRSI(candles) {
    const rsi = this.calculateRSI(candles);
    const rsiPeriod = 14;
    const stochPeriod = 14;

    const rsiValues = candles
      .map((_, i) =>
        this.calculateRSI(candles.slice(Math.max(0, i - rsiPeriod + 1), i + 1))
      )
      .slice(-stochPeriod);

    const minRSI = Math.min(...rsiValues);
    const maxRSI = Math.max(...rsiValues);

    return ((rsi - minRSI) / (maxRSI - minRSI)) * 100;
  }

  calculateRSI(candles, period = 14) {
    if (candles.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    // Calculate initial average gain and loss
    for (let i = 1; i <= period; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change >= 0) {
        gains += change;
      } else {
        losses -= change;
      }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Calculate RSI for remaining candles
    for (let i = period + 1; i < candles.length; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change >= 0) {
        avgGain = (avgGain * (period - 1) + change) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) - change) / period;
      }
    }

    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  calculateMACD(candles) {
    const ema12 = this.calculateEMA(candles, 12);
    const ema26 = this.calculateEMA(candles, 26);
    const macdLine = ema12 - ema26;
    const signalLine = this.calculateEMA(
      candles.map((_, i) => ({ ...candles[i], close: macdLine })),
      9
    );
    const histogram = macdLine - signalLine;

    return {
      value: macdLine,
      signal: signalLine,
      histogram,
    };
  }

  calculateEMA(candles, period) {
    const multiplier = 2 / (period + 1);
    let ema = candles[0].close;

    for (let i = 1; i < candles.length; i++) {
      ema = (candles[i].close - ema) * multiplier + ema;
    }

    return ema;
  }

  async getTicker(symbol) {
    try {
      const response = await this.fetchBinanceData(
        `${this.BINANCE_API}/ticker/24hr?symbol=${symbol}`
      );

      if (!response || typeof response !== "object") {
        throw new Error("Invalid response format from Binance API");
      }

      return {
        price: parseFloat(response.lastPrice),
        priceChangePercent: parseFloat(response.priceChangePercent),
        volume: parseFloat(response.volume),
      };
    } catch (error) {
      console.error("Error fetching ticker:", error);
      throw error;
    }
  }
}

// Make TradingService available globally
window.TradingService = TradingService;
