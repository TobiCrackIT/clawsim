const VAPI_BASE_URL = 'https://api.vapi.ai';

export type StartVapiCallInput = {
  to: string;
  assistantId: string;
  metadata?: Record<string, unknown>;
};

export type StartVapiCallResult = {
  id: string;
};

export async function startVapiCall(input: StartVapiCallInput): Promise<StartVapiCallResult> {
  const apiKey = process.env.VAPI_API_KEY;

  if (!apiKey) {
    throw new Error('VAPI_API_KEY is not set');
  }

  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  const phoneNumber = process.env.VAPI_PHONE_NUMBER;

  if (!phoneNumberId && !phoneNumber) {
    throw new Error('Set either VAPI_PHONE_NUMBER_ID or VAPI_PHONE_NUMBER');
  }

  const response = await fetch(`${VAPI_BASE_URL}/call`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      assistantId: input.assistantId,
      phoneNumberId,
      phoneNumber,
      customer: {
        number: input.to
      },
      metadata: input.metadata ?? {}
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vapi call start failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { id: string };

  return { id: data.id };
}
