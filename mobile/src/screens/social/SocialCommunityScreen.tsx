import React, { useCallback, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Bell, Sparkles, ChevronRight } from 'lucide-react-native';
import { useTheme } from '../../providers';
import { useStyles } from '../../hooks/useStyles';
import { Page, Status, stylesFor, useSocialApi, useSocialResource } from './shared';
import RetrospectivePanel from '../ai/RetrospectivePanel';
import SocialSettingsScreen from './SocialSettingsScreen';
import SocialReviewableOwnersScreen from './SocialReviewableOwnersScreen';
import SocialRankingsScreen from './SocialRankingsScreen';

export default function SocialCommunityScreen({ navigation }: { navigation: any }) {
  const api = useSocialApi(), s = useStyles(stylesFor), { colors } = useTheme();
  const [tab, setTab] = useState(0);
  const [showRetrospective, setShowRetrospective] = useState(false);
  const r = useSocialResource(useCallback(() => api.status(), [api]));
  if (!r.value) return <Page><Status {...r} /></Page>;
  if (!r.value.enabled) return <SocialSettingsScreen navigation={navigation} onEnabled={r.refresh} />;
  return <View style={s.screen}>
    <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 16 }}>
      <View style={s.row}>
        <Text style={[s.title, s.grow, { fontSize: 28 }]}>社群</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="消息" onPress={() => navigation.navigate('SocialInbox')} style={s.iconButton}>
          <Bell size={22} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>
      <View accessibilityRole="tablist" style={s.tabs}>
        {['互评账单', '排行榜'].map((label, index) => <TouchableOpacity key={label} accessibilityRole="tab" accessibilityState={{ selected: tab === index }} onPress={() => setTab(index)} style={[s.tab, tab === index && s.tabActive]}>
          <Text style={[s.buttonText, tab === index && s.primaryText]}>{label}</Text>
        </TouchableOpacity>)}
      </View>
      <TouchableOpacity accessibilityRole="button" onPress={() => setShowRetrospective(true)} style={[s.row, { paddingVertical: 8 }]}>
        <Sparkles size={21} color={colors.primary} />
        <View style={s.grow}><Text style={s.text}>AI 消费复盘</Text><Text style={s.small}>一起看懂开销，找到改进方向</Text></View>
        <ChevronRight size={18} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
    {showRetrospective && <RetrospectivePanel navigation={navigation} onClose={() => setShowRetrospective(false)} />}
    {tab === 0 ? <SocialReviewableOwnersScreen navigation={navigation} embedded /> : <SocialRankingsScreen navigation={navigation} />}
  </View>;
}
