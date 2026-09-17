import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useTheme } from '../../providers';
import { getAvatarUrl } from '../../utils/url';

export default function SocialAvatar({ avatar, nickname, size = 44 }: { avatar?: string | null; nickname?: string | null; size?: number }) {
  const { colors } = useTheme();
  const uri = getAvatarUrl(avatar);
  const [failed, setFailed] = useState<string | null>(null);
  const shape = { width: size, height: size, borderRadius: size / 2 };
  return <View style={[shape, { backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }]}>
    <Text style={{ color: '#1A1A1A', fontSize: size * 0.38, fontWeight: '700' }}>{Array.from(nickname?.trim() || '账')[0]}</Text>
    {uri && uri !== failed && <Image accessibilityLabel={`${nickname || '用户'}的头像`} source={{ uri }} onError={() => setFailed(uri)} style={[shape, { position: 'absolute' }]} />}
  </View>;
}
