import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { URL } from 'url';

if (admin.apps.length === 0) {
  admin.initializeApp();
}

exports.brazeTrackUninstallEvent = functions.analytics.event('app_remove').onLog(async (event, context) => {
  functions.logger.debug(`[Braze] app_remove event`, event, context);
  if (!process.env.BRAZE_REST_API_URL) {
    throw new Error('[Braze] Missing required BRAZE_REST_API_URL configuration');
  }
  if (!process.env.BRAZE_REST_API_KEY) {
    throw new Error('[Braze] Missing required BRAZE_REST_API_KEY configuration');
  }

  const brazeDeviceId = event.user?.userProperties.braze_device_id?.value || '';
  const brazeApiKey = event.user?.userProperties.braze_api_key?.value || '';
  const eventId = context.eventId;
  if (!brazeDeviceId) {
    functions.logger.warn(
      '[Braze] Missing braze_device_id to Braze for user: ',
      event.user?.userId,
      event.user?.deviceInfo
    );
    return;
  }

  if (!brazeApiKey) {
    functions.logger.warn(
      '[Braze] Missing braze_api_key to Braze for user: ',
      event.user?.userId,
      event.user?.deviceInfo
    );
    return;
  }

  axiosRetry(axios, {
    retries: 5,
    retryDelay: (...arg) => axiosRetry.exponentialDelay(...arg, 5000),
    retryCondition(error) {
      const status = error?.response?.status || 0;

      // 429
      if (status === 429) {
        return true;
      }

      // 4xx, not 3xx
      if ((status >= 400 && status < 500) || status < 300) {
        return false;
      }

      // 5xx or 2xx
      return true;
    },
    onRetry: (retryCount, error) => {
      functions.logger.info(
        `[Braze] Retry #${retryCount} uninstall tracking for braze_device_id: ${brazeDeviceId} braze_api_key: ${brazeApiKey}`,
        error.response
      );
    },
  });

  const trackingUrl = getTrackingUrl(process.env.BRAZE_REST_API_URL || '');
  const payload = {
    device_id: brazeDeviceId,
    api_key: brazeApiKey,
    event_id: eventId,
    time: new Date().toISOString(),
    event,
    context,
  };
  functions.logger.debug(`POST ${trackingUrl}`, payload);
  const response = await axios.post(trackingUrl, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.BRAZE_REST_API_KEY}`,
    },
  });

  if (response.status === 201 || response.status === 200) {
    functions.logger.info(`Uninstall Tracking Successful for ${brazeDeviceId}`, response.data);
  }
});

function getTrackingUrl(input: string): string {
  if (input.startsWith('https://') === false) {
    throw new Error('BRAZE_REST_API_URL must start with a proper https protocol');
  }

  const { origin } = new URL(input);

  // TODO: update to new endpoint
  return `${origin}/uninstall`;
}
